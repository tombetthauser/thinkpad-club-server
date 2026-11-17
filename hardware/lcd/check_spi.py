#!/usr/bin/env python3
"""Report Raspberry Pi details and whether SPI0 device 0 is accessible."""

import os
import stat
import sys
from pathlib import Path


SPI_DEVICE = Path("/dev/spidev0.0")


def main():
    model_path = Path("/proc/device-tree/model")
    if model_path.exists():
        model = model_path.read_bytes().rstrip(b"\0").decode(errors="replace")
        print(f"Model: {model}")
    else:
        print("Model: unavailable (not a Raspberry Pi device tree)")

    release_path = Path("/etc/os-release")
    if release_path.exists():
        for line in release_path.read_text().splitlines():
            if line.startswith("PRETTY_NAME="):
                print(f"OS: {line.partition('=')[2].strip('\"')}")
                break

    try:
        info = SPI_DEVICE.stat()
    except FileNotFoundError:
        print(f"FAIL: {SPI_DEVICE} is missing; SPI0 device 0 may not be enabled.")
        print("Enable SPI with sudo raspi-config, then reboot and check again.")
        return 1
    except PermissionError as error:
        print(f"FAIL: Cannot inspect {SPI_DEVICE}: {error}")
        return 1

    if not stat.S_ISCHR(info.st_mode):
        print(f"FAIL: {SPI_DEVICE} exists but is not a character device.")
        return 1

    print(f"SPI device: {SPI_DEVICE} exists")
    if not os.access(SPI_DEVICE, os.R_OK | os.W_OK):
        print(f"FAIL: Current user cannot read and write {SPI_DEVICE}.")
        print("Check the device permissions and the user's SPI group membership.")
        return 1

    print("SPI device: readable and writable by the current user")
    print("This checks device presence and permissions, not LCD communication.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
