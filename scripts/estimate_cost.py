"""Planning-stage transparent cost estimator.

No provider pricing is embedded. The caller must provide the rate and retry
assumption explicitly; unknown rates are not guessed.
"""
from __future__ import annotations

import argparse


def main() -> int:
    parser = argparse.ArgumentParser(description="Estimate accepted-shot cost")
    parser.add_argument("--seconds", type=float, required=True)
    parser.add_argument("--usd-per-second", type=float, required=True)
    parser.add_argument("--attempts", type=int, default=1)
    parser.add_argument("--shots", type=int, default=1)
    args = parser.parse_args()

    if args.seconds <= 0 or args.usd_per_second < 0 or args.attempts <= 0 or args.shots <= 0:
        parser.error("seconds, attempts and shots must be positive; rate must be non-negative")

    total = args.seconds * args.usd_per_second * args.attempts * args.shots
    print("AUTO3DVIDEO_COST_ESTIMATE")
    print(f"shots={args.shots}")
    print(f"seconds_per_attempt={args.seconds:g}")
    print(f"usd_per_second={args.usd_per_second:g}")
    print(f"attempts_per_shot={args.attempts}")
    print(f"estimated_total_usd={total:.4f}")
    print("actual_cost=unknown_until_provider_receipt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
