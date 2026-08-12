# Paseo npm bundle

Install Node.js 22, extract this archive, then run the installer for your platform.

Linux and macOS:

```bash
./install.sh
paseo daemon start
```

Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
paseo daemon start
```

The installer uses the six bundled Paseo workspace packages. Third-party dependencies are fetched
from the configured npm registry during installation.

The same six `.tgz` files are also attached separately to the GitHub Release. They can be passed
together to `npm install --global` without extracting this bundle.
