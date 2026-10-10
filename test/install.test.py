"""Exercise installer persistence with real dependencies and a substituted service manager."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import secrets
import shutil
import shlex
import signal
import subprocess
import tempfile
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


def run_installer(checkout, env, answers):
    master, slave = pty.openpty()

    def terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    process = subprocess.Popen(
        ["bash", str(checkout / "scripts/install.sh")], cwd=checkout, env=env,
        stdin=slave, stdout=slave, stderr=slave, preexec_fn=terminal,
    )
    os.close(slave)
    output = ""
    pending = list(answers)
    deadline = time.monotonic() + 180
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
                raise TimeoutError(f"Installer exceeded its test deadline.\n{output}")
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
            if not chunk:
                break
            output += chunk.decode("utf8", errors="replace")
            while pending and pending[0][0] in output:
                _, answer = pending.pop(0)
                os.write(master, (answer + "\n").encode())
        status = process.wait(timeout=5)
        if pending:
            raise AssertionError(f"Installer did not reach prompt {pending[0][0]!r}.\n{output}")
        return status, output
    finally:
        os.close(master)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


class InstallerSmokeTest(unittest.TestCase):
    @unittest.skipIf(os.geteuid() == 0, "The installer requires a non-root Linux user")
    def test_install_and_rerun_preserve_configuration_data_and_secret_privacy(self):
        with tempfile.TemporaryDirectory(prefix="finrod-install-test-") as temporary:
            directory = Path(temporary)
            checkout = directory / "checkout"
            home = directory / "home"
            tools = directory / "bin"
            runtime = directory / "runtime"
            for path in (checkout, home, tools, runtime):
                path.mkdir(mode=0o700)
            for name in ("package.json", "package-lock.json", "tsconfig.json"):
                shutil.copy2(ROOT / name, checkout / name)
            for name in ("src", "scripts", "deploy"):
                shutil.copytree(ROOT / name, checkout / name)

            node = tools / "node"
            node.write_text("#!/bin/sh\nexec " + shlex.quote(shutil.which("node")) + ' "$@"\n')
            node.chmod(0o700)
            manager = tools / "systemctl"
            manager.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
file = Path(os.environ['HOME']) / 'service-state.json'
state = json.loads(file.read_text()) if file.exists() else {'active': False, 'enabled': False}
args = sys.argv[1:]
if args[0] == '--user': args = args[1:]
command = args[0]
if command == 'show-environment': pass
elif command == 'show': print('active' if state['active'] else 'inactive')
elif command == 'stop': state['active'] = False
elif command == 'daemon-reload': pass
elif command == 'enable': state['enabled'] = True
elif command == 'restart':
    assert (Path(os.environ['HOME']) / '.config/systemd/user/finrod.service').is_file()
    state['active'] = True
elif command == 'is-active':
    print('active' if state['active'] else 'inactive')
    if not state['active']: sys.exit(3)
else: raise RuntimeError('Unexpected service-manager operation: ' + repr(args))
file.write_text(json.dumps(state))
""")
            manager.chmod(0o700)
            env = {
                "HOME": str(home), "PATH": str(tools) + os.pathsep + os.environ["PATH"],
                "LANG": "C.UTF-8", "TERM": "dumb", "npm_config_cache": str(directory / "npm-cache"),
                "XDG_RUNTIME_DIR": str(runtime),
            }
            model = subprocess.check_output([
                "node", "--input-type=module", "-e",
                'import {openrouterProvider} from "@earendil-works/pi-ai/providers/openrouter"; '
                'console.log(openrouterProvider().getModels()[0].id);',
            ], cwd=ROOT, env=env, text=True).strip()
            bot_secret = "123456:" + secrets.token_hex(16)
            provider_secret = "[REDACTED]" + secrets.token_hex(16)
            logs = []
            try:
                status, output = run_installer(checkout, env, [
                    ("Telegram bot token:", bot_secret),
                    ("Your numeric Telegram user ID:", "42"),
                    ("Chat provider (", "openrouter"),
                    ("Chat model ID from", model),
                    ("OPENROUTER_API_KEY:", provider_secret),
                    ("Transcription provider (", "openrouter"),
                    ("Transcription model ID (", ""),
                    ("Transcription language code (", ""),
                    ("Exa API key (", ""),
                ])
                logs.extend(Path(name) for name in re.findall(r"Log: (/tmp/finrod-install\.[A-Za-z0-9]+\.log)", output))
                self.assertEqual(status, 0, output)
                self.assertNotIn(bot_secret, output)
                self.assertNotIn(provider_secret, output)
                environment = home / ".config/finrod/environment"
                configuration = environment.read_text()
                self.assertIn("TELEGRAM_BOT_TOKEN='" + bot_secret + "'", configuration)
                self.assertIn("OPENROUTER_API_KEY='" + provider_secret + "'", configuration)
                self.assertEqual(environment.stat().st_mode & 0o777, 0o600)
                self.assertTrue((checkout / "dist/main.js").is_file())
                unit = home / ".config/systemd/user/finrod.service"
                original_unit = unit.read_bytes()
                self.assertIn("WorkingDirectory=" + str(checkout), original_unit.decode())
                self.assertIn("ReadWritePaths=" + str(home / ".local/share/finrod"), original_unit.decode())
                self.assertEqual(json.loads((home / "service-state.json").read_text()), {"active": True, "enabled": True})

                environment.write_text(configuration + "\n# Owner-maintained override\nTRANSCRIPTION_LANGUAGE='en'\n")
                expected_config = environment.read_bytes()
                topic = home / ".local/share/finrod/knowledge/retained-topic.md"
                topic.parent.mkdir()
                topic.write_text("# Retained topic\nKeep this across installation reruns.\n")
                expected_topic = topic.read_bytes()
                status, output = run_installer(checkout, env, [("Finrod is running. Stop it", "y")])
                logs.extend(Path(name) for name in re.findall(r"Log: (/tmp/finrod-install\.[A-Za-z0-9]+\.log)", output))
                self.assertEqual(status, 0, output)
                self.assertEqual(environment.read_bytes(), expected_config)
                self.assertEqual(environment.stat().st_mode & 0o777, 0o600)
                self.assertEqual(topic.read_bytes(), expected_topic)
                self.assertEqual(unit.read_bytes(), original_unit)
                self.assertEqual(json.loads((home / "service-state.json").read_text()), {"active": True, "enabled": True})
                self.assertNotIn(bot_secret, output)
                self.assertNotIn(provider_secret, output)
                self.assertTrue(logs, "Installation must report its log location")
                for log in set(logs):
                    content = log.read_text()
                    self.assertNotIn(bot_secret, content)
                    self.assertNotIn(provider_secret, content)
            finally:
                for log in set(logs):
                    log.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
