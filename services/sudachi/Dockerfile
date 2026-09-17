FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --shell /usr/sbin/nologin app \
    && chown -R app:app /app
USER app

COPY --chown=app:app main.py .

EXPOSE 8300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8300/health')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8300"]
