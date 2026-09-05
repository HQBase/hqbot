#if os(macOS)
import Foundation
import Darwin

final class CommandProcess: @unchecked Sendable {
    private let lock = NSLock()
    private var pid: pid_t = 0
    private var cancelled = false
    private var output = Data()
    func cancel(force: Bool = false) {
        lock.lock(); cancelled = true; let child = pid; lock.unlock()
        if child > 0 {
            kill(-child, force ? SIGKILL : SIGTERM)
            if !force { DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                self.lock.lock(); defer { self.lock.unlock() }
                if self.pid == child { kill(-child, SIGKILL) }
            } }
        }
    }
    func run(command: String, directory: URL) -> (String, String) {
        var descriptors: [Int32] = [0, 0]
        guard pipe(&descriptors) == 0 else { return ("failed", "Could not open the command output pipe.") }
        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        posix_spawn_file_actions_init(&actions); posix_spawnattr_init(&attributes)
        defer { posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attributes) }
        posix_spawn_file_actions_adddup2(&actions, descriptors[1], STDOUT_FILENO)
        posix_spawn_file_actions_adddup2(&actions, descriptors[1], STDERR_FILENO)
        posix_spawn_file_actions_addclose(&actions, descriptors[0])
        posix_spawn_file_actions_addclose(&actions, descriptors[1])
        posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_addchdir_np(&actions, directory.path)
        posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
        posix_spawnattr_setpgroup(&attributes, 0)
        let args: [UnsafeMutablePointer<CChar>?] = ["/bin/sh", "-c", command].map { $0.withCString { strdup($0) } } + [nil]
        let vars = ["PATH=/usr/bin:/bin:/usr/sbin:/sbin", "HOME=\(directory.path)", "TMPDIR=/tmp", "LANG=en_US.UTF-8"].map { $0.withCString { strdup($0) } } + [nil]
        defer { for item in args + vars { if let item { free(item) } } }
        var child: pid_t = 0
        lock.lock()
        if cancelled { lock.unlock(); close(descriptors[0]); close(descriptors[1]); return ("uncertain", "Command stopped before execution.") }
        let status = posix_spawn(&child, "/bin/sh", &actions, &attributes, args, vars)
        if status == 0 { pid = child }
        lock.unlock(); close(descriptors[1])
        guard status == 0 else { close(descriptors[0]); return ("failed", "The command process could not start (\(status)).") }
        let readFD = descriptors[0]
        let reader = DispatchGroup(); reader.enter()
        DispatchQueue.global().async {
            var bytes = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = Darwin.read(readFD, &bytes, bytes.count)
                if count <= 0 { break }
                self.lock.lock()
                let keep = min(count, max(0, 32000 - self.output.count))
                self.output.append(contentsOf: bytes.prefix(keep)); self.lock.unlock()
            }
            close(readFD); reader.leave()
        }
        let timeout = DispatchWorkItem { [weak self] in self?.cancel() }
        DispatchQueue.global().asyncAfter(deadline: .now() + 60, execute: timeout)
        var waitStatus: Int32 = 0
        while waitpid(child, &waitStatus, 0) == -1 && errno == EINTR {}
        timeout.cancel()
        // Stop children left in this process group, including after a shell exits early.
        kill(-child, SIGKILL)
        _ = reader.wait(timeout: .now() + 2)
        lock.lock(); pid = 0; let wasCancelled = cancelled; let data = output; lock.unlock()
        let text = String(decoding: data, as: UTF8.self)
        let message = String((text + (data.count >= 32000 ? "\n[Output capped at 32 KB]" : "")).prefix(32000))
        return (wasCancelled ? "uncertain" : waitStatus == 0 ? "completed" : "failed", message.isEmpty ? "Command exited with status \(waitStatus)." : message)
    }
}
#endif
