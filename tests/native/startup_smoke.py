"""Run #27 against the real OS/window/WebView, using an isolated test build.

Only Python's standard library is required. The Cargo native-smoke feature adds
an observer; no native test controls are compiled into the default application.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
NAME = "Shui Native Smoke"
IDENTIFIER = "com.shui.native-smoke"


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, PermissionError):
        return None


class Application:
    def __init__(self, command, output):
        self.directory = Path(tempfile.mkdtemp(prefix="process-", dir=output))
        self.sequence = 0
        self.log = (self.directory / "application.log").open("w", encoding="utf-8")
        env = os.environ.copy()
        env["SHUI_NATIVE_SMOKE_DIR"] = str(self.directory)
        self.process = subprocess.Popen(command, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        self.state = None

    def wait(self, predicate, message, timeout=45):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.state = read_json(self.directory / "state.json")
            if self.state and self.state["pid"] == self.process.pid:
                if self.state["error"]:
                    raise AssertionError(self.state["error"])
                if predicate(self.state):
                    return self.state
            if self.process.poll() is not None:
                raise AssertionError(f"App exited ({self.process.returncode}): {message}")
            time.sleep(0.1)
        raise AssertionError(f"Timed out: {message}; last state: {self.state}")

    def ready(self):
        return self.wait(lambda s: s["timer_listener"] and s["tray_menu"] and s["tray"],
                         "the real WebView must register its timer listener and tray menu")

    def action(self, action):
        self.sequence += 1
        path = self.directory / "command.json"
        temporary = path.with_suffix(".next")
        temporary.write_text(json.dumps({"id": self.sequence, "action": action}), encoding="utf-8")
        os.replace(temporary, path)
        if action != "exit":
            return self.wait(lambda s: s["acknowledged"] == self.sequence, action)

    def stop(self, preserve_registration=False):
        if self.process.poll() is None:
            if not preserve_registration and self.state and self.state["autostart"]:
                self.action("disable-autostart")
            self.action("exit")
            self.process.wait(timeout=15)
        assert self.process.returncode == 0, self.process.returncode
        self.log.close()


def registered_command():
    if sys.platform == "win32":
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Run") as key:
            return winreg.QueryValueEx(key, NAME)[0]
    if sys.platform == "darwin":
        path = Path.home() / "Library" / "LaunchAgents" / f"{NAME}.plist"
        return plistlib.loads(path.read_bytes())["ProgramArguments"]
    path = Path.home() / ".config" / "autostart" / f"{NAME}.desktop"
    entry = next(line[5:] for line in path.read_text().splitlines() if line.startswith("Exec="))
    return shlex.split(entry)


def remove_test_registration():
    if sys.platform == "win32":
        import winreg
        for path in [r"Software\Microsoft\Windows\CurrentVersion\Run",
                     r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"]:
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_SET_VALUE) as key:
                    winreg.DeleteValue(key, NAME)
            except FileNotFoundError:
                pass
    else:
        path = (Path.home() / "Library/LaunchAgents" / f"{NAME}.plist" if sys.platform == "darwin"
                else Path.home() / ".config/autostart" / f"{NAME}.desktop")
        path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--window-manager", help="Linux X11 window manager, e.g. openbox")
    args = parser.parse_args()
    output = args.artifacts.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.build:
        env = os.environ.copy()
        env["TAURI_CONFIG"] = (ROOT / "src-tauri/tauri.smoke.conf.json").read_text()
        subprocess.run(["cargo", "build", "--locked", "--features", "native-smoke,tauri/custom-protocol"],
                       cwd=ROOT, env=env, check=True)
    target = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "target"))
    if not target.is_absolute():
        target = ROOT / target
    executable = target / "debug" / ("shui.exe" if sys.platform == "win32" else "shui")
    # Use a copy so the smoke build cannot replace a developer's installed app.
    app_directory = Path(tempfile.mkdtemp(prefix="app-", dir=output))
    if sys.platform == "darwin":
        bundle = app_directory / f"{NAME}.app" / "Contents"
        binary_directory = bundle / "MacOS"
        binary_directory.mkdir(parents=True)
        info = plistlib.loads((ROOT / "src-tauri/Info.plist").read_bytes())
        info.update(CFBundleIdentifier=IDENTIFIER, CFBundleName=NAME,
                    CFBundleExecutable="shui", CFBundlePackageType="APPL",
                    CFBundleVersion="0.2.32", NSHighResolutionCapable=True)
        (bundle / "Info.plist").write_bytes(plistlib.dumps(info))
    else:
        binary_directory = app_directory / "installed app"
        binary_directory.mkdir()
    binary = binary_directory / executable.name
    shutil.copy2(executable, binary)
    if sys.platform == "darwin":
        subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(bundle.parent)], check=True)
    window_manager = None
    applications, checks = [], []
    data_directory = None
    registration_owned = False
    report = {"platform": sys.platform, "checks": checks, "passed": False}

    def check(description, condition):
        assert condition, description
        checks.append(description)
        print(f"PASS: {description}", flush=True)

    def start(command):
        nonlocal data_directory
        application = Application(command, output)
        applications.append(application)
        state = application.ready()
        data_directory = Path(state["data_dir"])
        assert data_directory.name == IDENTIFIER, data_directory
        return application

    def secondary(command, application):
        result = subprocess.run(command, timeout=20, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        assert result.returncode == 0, result.stdout.decode(errors="replace")
        check("second invocation exits while the original process stays alive",
              application.process.poll() is None)

    def quiet(application):
        for _ in range(10):
            state = application.wait(lambda s: True, "silent state")
            assert not state["main"]["visible"] and not state["main"]["focused"], state
            assert not state["early_visible"] and not state["early_focus"], state
            time.sleep(0.1)
        check("silent startup remains hidden and unfocused with a live frontend/tray", True)

    try:
        if args.window_manager:
            window_manager = subprocess.Popen([args.window_manager], stdout=subprocess.DEVNULL,
                                              stderr=subprocess.DEVNULL)
            time.sleep(1)
            assert window_manager.poll() is None, "X11 window manager failed to start"
        application = start([str(binary), "--silent"])
        check("native main window is created hidden and unfocused",
              application.state["initial_window"] == {"visible": False, "focused": False})
        check("isolated autostart entry is initially absent", not application.state["autostart"])
        quiet(application)
        secondary([str(binary), "--silent"], application)
        quiet(application)
        application.action("interactive")
        secondary([str(binary)], application)
        application.wait(lambda s: s["main"]["visible"], "manual relaunch displays existing settings")
        check("manual relaunch displays the existing settings window", True)
        application.action("close")
        application.wait(lambda s: not s["main"]["visible"], "close hides settings")
        application.action("tray-settings")
        application.wait(lambda s: s["main"]["visible"], "real tray callback shows settings")
        check("the real frontend tray preferences callback reopens hidden settings", True)
        application.action("minimize")
        application.wait(lambda s: s["main"]["minimized"], "settings are minimized")
        secondary([str(binary)], application)
        application.wait(lambda s: s["main"]["visible"] and not s["main"]["minimized"], "restore settings")
        check("manual relaunch restores minimized settings", True)
        application.action("close")
        application.wait(lambda s: not s["main"]["visible"], "hide before autostart")
        registration_owned = True  # Initial absence was asserted before taking ownership.
        application.action("enable-autostart")
        application.wait(lambda s: s["autostart"], "native autostart registration")
        registered = registered_command()
        check("the OS startup entry contains --silent", "--silent" in registered)
        (output / "startup-command.json").write_text(json.dumps(registered, ensure_ascii=False), encoding="utf-8")
        application.stop(preserve_registration=True)
        application = start(registered)
        quiet(application)
        check("the exact registered OS command starts a new silent instance", application.state["autostart"])
        application.action("remind")
        application.wait(lambda s: s["session"] and s["visible_reminders"] and s["reminder_loaded"],
                         "hidden WebView dispatches the native timer reminder")
        check("the native timer triggers a loaded reminder while settings stay hidden",
              not application.state["main"]["visible"])
        application.action("finish-reminder")
        application.wait(lambda s: not s["visible_reminders"] and s["timer_running"], "reminder cleanup and timer resume")
        check("reminder closes and background timing resumes", not application.state["main"]["visible"])
        application.action("disable-autostart")
        application.wait(lambda s: not s["autostart"], "remove native autostart registration")
        check("native autostart registration can be removed", True)
        application.stop()
        application = start([str(binary)])
        application.wait(lambda s: s["main"]["visible"], "manual cold launch shows settings")
        check("manual cold launch displays settings", True)
        application.stop()
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        for application in reversed(applications):
            if application.process.poll() is None:
                try:
                    application.stop()
                except Exception as error:
                    report.setdefault("cleanup_errors", []).append(str(error))
                    application.process.kill()
                    application.process.wait(timeout=10)
            if application.state:
                if data_directory is None:
                    data_directory = Path(application.state["data_dir"])
                (application.directory / "last-state.json").write_text(json.dumps(application.state, indent=2), encoding="utf-8")
        if registration_owned:
            remove_test_registration()
        if window_manager:
            window_manager.terminate()
            window_manager.wait(timeout=10)
        if data_directory and data_directory.name == IDENTIFIER and data_directory.exists():
            shutil.copytree(data_directory, output / "app-data", dirs_exist_ok=True)
            shutil.rmtree(data_directory)
        report["checks_passed"] = len(checks)
        (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        shutil.rmtree(app_directory)
        print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
