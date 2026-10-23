#!/usr/bin/env python3

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROW_COUNT = 50
OUTPUT_PATH = Path("sensor_data.csv")


def main() -> None:
    start = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=ROW_COUNT - 1)

    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        writer.writerow(["timestamp", "sensor_id", "temperature_c", "humidity_percent", "pressure_hpa", "battery_percent"])

        for index in range(ROW_COUNT):
            writer.writerow(
                [
                    (start + timedelta(minutes=index)).isoformat(),
                    f"sensor-{random.randint(1, 5):02d}",
                    round(random.uniform(18.0, 32.0), 2),
                    round(random.uniform(30.0, 80.0), 2),
                    round(random.uniform(980.0, 1040.0), 2),
                    random.randint(20, 100),
                ]
            )

    print(f"Generated {ROW_COUNT} rows in {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
