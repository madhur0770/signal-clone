from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC timestamp (the schema stores timezone-naive UTC datetimes)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
