#!/usr/bin/env python3
"""Show a brief LCD test screen, then Hello World, until interrupted."""

import time
from pathlib import Path


SPI_DEVICE = Path("/dev/spidev0.0")


def main():
    if not SPI_DEVICE.exists():
        raise SystemExit(
            f"{SPI_DEVICE} is missing. Enable SPI, reboot, and run check_spi.py."
        )

    try:
        from luma.core.interface.serial import spi
        from luma.core.render import canvas
        from luma.lcd.device import pcd8544
    except ImportError as error:
        raise SystemExit(
            "LCD libraries are missing. Install luma.lcd in the LCD virtual "
            "environment, then run this script with that environment's Python."
        ) from error

    serial = spi(
        port=0,
        device=0,
        gpio_DC=24,
        gpio_RST=25,
        bus_speed_hz=1_000_000,
    )
    lcd = pcd8544(serial)

    with canvas(lcd) as draw:
        draw.rectangle(lcd.bounding_box, outline="white", fill="black")
        draw.text((24, 18), "Hello LCD world! Testing :^)", fill="white")
    print("LCD test screen should be displayed.")

    time.sleep(2)

    with canvas(lcd) as draw:
        draw.rectangle(lcd.bounding_box, outline="white", fill="black")
        draw.text((8, 18), "Hello World :^P", fill="white")
    print("Hello World should be on the LCD. Press Ctrl+C to exit.")

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nLCD test stopped.")


if __name__ == "__main__":
    main()
