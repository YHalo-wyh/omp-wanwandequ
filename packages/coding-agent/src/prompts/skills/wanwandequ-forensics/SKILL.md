---
name: wanwandequ-forensics
description: Fast-path CTF forensics workflow for format fingerprinting, targeted extraction, artifact correlation, and reproducible flag recovery.
---

# Wanwandequ Forensics Fast Path

Use this skill for authorized CTF forensics and misc evidence analysis. Start from file structure and metadata, not from a shotgun list of stego tools.

## Fingerprint first

Identify true file types, container layers, timestamps, metadata, embedded objects, compression, streams/tracks, and anomalies. Use `file`, `xxd/hexdump`, `binwalk`, `exiftool`, archive listing, strings with offsets, and format-specific parsers before destructive extraction.

## Pick the discriminator

Choose tools based on evidence: zsteg/stegsolve-like analysis for plausible image channels, ffmpeg/spectrograms for media, tshark for packet captures, Volatility for memory images, Sleuthkit for filesystems, foremost/scalpel only when carving is justified. For custom encodings, write a decoder as soon as the transform is understood.

Preserve source hashes and do work on copies. Record offsets, channels, packet filters, stream IDs, passwords/keys, and extraction commands so another context can reproduce the path.

## Correlate instead of over-extracting

When multiple artifacts exist, correlate names, timestamps, protocol sessions, metadata, and partial plaintext before opening new search branches. A small confirmed clue should narrow the next tool choice.

## Flag standard

A candidate flag must be present in an extracted artifact, decoded stream, recovered memory/file content, or reproducible script output. Keep the exact extraction command and source artifact as verifier evidence.
