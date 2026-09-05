#!/usr/bin/env python3
"""Build an unsigned Apple app with the installed Xcode SDK; no package download."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("platform", choices=["macos", "ios-simulator"])
parser.add_argument("--output", default="build")
args = parser.parse_args()
root = Path(__file__).resolve().parent
out = (root / args.output / args.platform / "HQBot.app").resolve()
mac = args.platform == "macos"
binary = out / "Contents/MacOS/HQBot" if mac else out / "HQBot"
resources = out / "Contents/Resources" if mac else out
binary.parent.mkdir(parents=True, exist_ok=True)
resources.mkdir(parents=True, exist_ok=True)
sdk_name = "macosx" if mac else "iphonesimulator"
sdk = subprocess.check_output(["xcrun", "--sdk", sdk_name, "--show-sdk-path"], text=True).strip()
arch = os.uname().machine
command = ["xcrun", "--sdk", sdk_name, "swiftc", "-parse-as-library", "-swift-version", "5", "-sdk", sdk,
           "-target", f"{arch}-apple-macos13.0" if mac else f"{arch}-apple-ios17.0-simulator",
           "-module-cache-path", str(root / "build/ModuleCache"), "-O", "-framework", "SwiftUI", "-framework", "WebKit", "-framework", "Security"]
command += [str(path) for path in sorted(root.glob("*.swift")) if not path.name.endswith("Tests.swift")]
subprocess.run(command + ["-o", str(binary)], check=True)
info = {"CFBundleIdentifier": "com.hqbot.app", "CFBundleName": "HQBot", "CFBundleDisplayName": "HQBot",
        "CFBundleExecutable": "HQBot", "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "1", "NSHumanReadableCopyright": "HQBot contributors. AGPL-3.0-only.",
        "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": False}}
if mac:
    info["LSMinimumSystemVersion"] = "13.0"
    info["NSHighResolutionCapable"] = True
else:
    info.update({"MinimumOSVersion": "17.0", "LSRequiresIPhoneOS": True, "UIDeviceFamily": [1, 2],
                 "UILaunchScreen": {}, "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]})
with (out / "Contents/Info.plist" if mac else out / "Info.plist").open("wb") as stream:
    plistlib.dump(info, stream)
subprocess.run(["codesign", "--force", "--sign", "-", str(out)], check=True)
print(out)
