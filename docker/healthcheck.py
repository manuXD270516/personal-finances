"""Chequeo de salud de la imagen finance-ml (sin curl ni shell): sale con 0 si la URL responde 2xx."""

import sys
import urllib.request


def main(url: str) -> int:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:  # noqa: S310 - URL fija de loopback
            return 0 if 200 <= response.status < 300 else 1
    except Exception:  # noqa: BLE001
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
