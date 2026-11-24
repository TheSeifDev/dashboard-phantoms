#!/usr/bin/env python3
"""Extract a `CREATE OR REPLACE FUNCTION public.<name>` block from a migration file.

Used to re-emit existing function definitions with a different authorization
guard instead of hand-copying long bodies.
"""
import re
import sys


def extract(path: str, name: str) -> str:
    source = open(path, encoding='utf-8').read()
    pattern = re.compile(
        r"CREATE OR REPLACE FUNCTION public\." + re.escape(name) + r"\s*\(",
    )
    match = pattern.search(source)
    if not match:
        raise SystemExit(f"function {name} not found in {path}")
    start = match.start()
    end = source.find("\n$$;", start)
    if end == -1:
        raise SystemExit(f"unterminated function {name} in {path}")
    return source[start:end + len("\n$$;")]


if __name__ == '__main__':
    print(extract(sys.argv[1], sys.argv[2]))
