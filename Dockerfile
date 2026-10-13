FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY web ./web
COPY dataset/images ./dataset/images
COPY ["llm_run/llm collected", "./llm_run/llm collected"]
ENV MEMEWIKI_STORAGE_DIR=/data
VOLUME /data
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn web.server:create_app --factory --host 0.0.0.0 --port ${PORT:-8080}"]
