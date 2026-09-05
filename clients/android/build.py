#!/usr/bin/env python3
"""Build a local debug APK with an existing JDK and Android SDK, without Gradle downloads."""
import argparse
from pathlib import Path
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--java", required=True, help="JDK home")
parser.add_argument("--platform", required=True, help="SDK platform directory with android.jar")
parser.add_argument("--tools", required=True, help="SDK build-tools directory")
args = parser.parse_args()
root = Path(__file__).resolve().parent
out = root / "app/build/standalone"
out.mkdir(parents=True, exist_ok=True)
java = Path(args.java).resolve()
platform = Path(args.platform).resolve()
tools = Path(args.tools).resolve()
classes = out / "classes"
classes.mkdir(exist_ok=True)
def run(values): subprocess.run([str(v) for v in values], check=True)
run([java / "bin/javac", "-source", "17", "-target", "17", "-classpath", platform / "android.jar", "-d", classes,
     *sorted((root / "app/src/main/java").rglob("*.java"))])
run([java / "bin/java", "-cp", tools / "lib/d8.jar", "com.android.tools.r8.D8", "--lib", platform / "android.jar", "--min-api", "26", "--output", out, *sorted(classes.rglob("*.class"))])
manifest = out / "AndroidManifest.xml"
manifest.write_text((root / "app/src/main/AndroidManifest.xml").read_text().replace('<manifest ', '<manifest package="com.hqbot.app" '))
unsigned = out / "hqbot-unsigned.apk"
run([tools / "aapt2", "link", "-I", platform / "android.jar", "--manifest", manifest,
     "--min-sdk-version", "26", "--target-sdk-version", "35", "--version-code", "1", "--version-name", "0.1.0", "-o", unsigned])
with zipfile.ZipFile(unsigned, "a", compression=zipfile.ZIP_DEFLATED) as archive:
    for dex in out.glob("classes*.dex"): archive.write(dex, dex.name)
aligned = out / "hqbot-debug.apk"
run([tools / "zipalign", "-f", "4", unsigned, aligned])
key = out / "debug.keystore"
if not key.exists():
    run([java / "bin/keytool", "-genkeypair", "-keystore", key, "-storepass", "android", "-keypass", "android", "-alias", "androiddebugkey", "-keyalg", "RSA", "-keysize", "2048", "-validity", "365", "-dname", "CN=HQBot Local Debug,O=HQBot,C=US"])
run([java / "bin/java", "-jar", tools / "lib/apksigner.jar", "sign", "--ks", key, "--ks-pass", "pass:android", "--key-pass", "pass:android", aligned])
run([java / "bin/java", "-jar", tools / "lib/apksigner.jar", "verify", "--verbose", aligned])
print(aligned)
