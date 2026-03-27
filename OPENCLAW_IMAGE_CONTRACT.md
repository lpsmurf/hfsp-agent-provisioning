# OpenClaw Image Contract

## Purpose
This document captures the build and runtime contract for the OpenClaw tenant runtime image used by the HFSP Agent Provisioning system.

## Build source
- Docker build context: `./tenant-runtime-image`
- Primary Dockerfile: `tenant-runtime-image/Dockerfile`
- Pinned OpenClaw version: `tenant-runtime-image/OPENCLAW_VERSION`

## Current pinned version
- `2026.3.13`

## Resulting image behavior
The image is expected to:
- install the pinned OpenClaw CLI version
- run under a non-root user (`hfsp`)
- mount tenant workspace and secret directories at runtime
- start the OpenClaw gateway through the entrypoint script

## Runtime entrypoint
- Entrypoint file: `tenant-runtime-image/entrypoint.sh`
- Entry command: OpenClaw gateway run with forced mode

## Required runtime environment
- `HOME=/home/hfsp`
- `ANTHROPIC_API_KEY` optional if provided via env or mounted secret file
- `OPENAI_API_KEY` optional if provided via env or mounted secret file

## Mounted paths expected at runtime
- `/home/hfsp/.openclaw/openclaw.json` — read-only bind mount
- `/home/hfsp/.openclaw/secrets` — read-only bind mount
- `/tenant/workspace` — tenant workspace bind mount

## Lifecycle contract
The provisioner must support the following lifecycle:
1. create container
2. start container
3. confirm container is running
4. run health check inside container
5. stop container
6. remove container

## Success criteria
A valid image must:
- build successfully from the repo’s `tenant-runtime-image` directory
- start successfully in Docker
- pass the health check used by the provisioner POC
- cleanly stop and remove without manual cleanup

## Failure modes to document
- missing build context
- missing OpenClaw package/version in the Docker build
- runtime config missing or not mounted correctly
- secret/env resolution failure
- container start failure
- health check failure

## Verified note
The POC build and lifecycle test were successfully run on PIERCALITO using a locally built image named:
- `hfsp-openclaw-runtime:local`
