FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

RUN useradd --system --home-dir /data --shell /usr/sbin/nologin blossom \
    && mkdir -p /data \
    && chown blossom:blossom /data

ENV BLOSSOM_GIS_DATA=/data
VOLUME /data
EXPOSE 8787
USER blossom

CMD ["uvicorn", "blossom_gis.app:app", "--host", "0.0.0.0", "--port", "8787"]
