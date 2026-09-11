---
name: wanwandequ-misc-triage
description: Low-cost CTF triage for encodings, archives, file-format tricks, nested transforms, metadata, and obvious artifact extraction before deeper specialization.
---

# Wanwandequ Misc / Low-Hanging Triage

Run this playbook when the category is misc/unknown or when an attachment may hide a cheap transform before the real task.

## First 90 seconds

Identify true file type, magic vs extension mismatch, archive/container nesting, metadata, printable strings with offsets, obvious Base-N/hex/url/HTML encodings, compression signatures, appended data, multiple embedded files, and repeated/high-entropy regions.

Use deterministic probes first: `file`, `xxd`/hexdump, `strings`, archive listing, `binwalk` where available, `exiftool`, and small Python decoders. Do not recursively unpack everything without preserving a tree of provenance.

## Encoding ladder

For suspicious text, test transformations that are strongly signaled by alphabet/length/padding: hex, base16/32/64/85, URL percent encoding, HTML entities, escaped bytes, ROT/Caesar only when language structure supports it, and XOR only when key-size/evidence makes it bounded. After every decode, re-fingerprint the output rather than continuing a blind chain.

## Container and polyglot checks

Compare declared size/offset tables against actual file size. Inspect tails after end markers, secondary magic values, alternate streams/chunks, malformed length fields, and concatenated archives. For images/media, hand off to the specialized forensics skill once channel/stream evidence exists.

## Automation discipline

When more than two transforms repeat, write a small decoder that records each stage and hash. Keep original files immutable. Any extracted candidate flag must retain the exact chain of source file -> offset/stream -> transform -> output.
