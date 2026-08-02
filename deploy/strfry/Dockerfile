# strfry with the corpus write policy baked in. The base image ships strfry and
# its default config; we add python3 for the policy plugin and overlay our conf.
FROM dockurr/strfry:1.1.1

USER root
RUN apk add --no-cache python3

COPY strfry.conf /etc/strfry.conf
COPY write-policy.py /app/write-policy.py
RUN chmod 0755 /app/write-policy.py
