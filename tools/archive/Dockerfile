# For a home server: docker build -t phoenix-archive tools/archive
FROM python:3.12-slim-bookworm

# ffmpeg reads the videos; MediaPipe needs the EGL/GLES libraries even on the CPU
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libegl1 libgles2 \
 && rm -rf /var/lib/apt/lists/*

ENV XDG_CACHE_HOME=/opt/cache PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml README.md ./
COPY phoenix_archive ./phoenix_archive
RUN pip install --no-cache-dir ".[heic]" \
 && phoenix-archive model \
 && chmod -R a+rX /opt/cache

ENTRYPOINT ["phoenix-archive"]
