# Throwaway image for scripts/sandbox-e2e.sh: a newcomer machine with only Node.
# Variants are build args so each missing-tool scenario is a separate image.
ARG NODE_IMAGE=node:20-slim
FROM ${NODE_IMAGE}

ARG WITH_GIT=1
ARG WITH_GH=0
ARG GH_VERSION=2.63.2
ARG AEL_SOURCE=tarball
ARG AEL_VERSION=latest

RUN set -e; \
    pkgs=""; \
    if [ "$WITH_GIT" = "1" ]; then pkgs="$pkgs git"; fi; \
    if [ "$WITH_GH" = "1" ]; then pkgs="$pkgs curl ca-certificates"; fi; \
    if [ -n "$pkgs" ]; then apt-get update -qq && apt-get install -y -qq --no-install-recommends $pkgs >/dev/null && rm -rf /var/lib/apt/lists/*; fi; \
    if [ "$WITH_GH" = "1" ]; then \
      arch=$(dpkg --print-architecture); \
      curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.tar.gz" | tar -xz -C /tmp; \
      mv /tmp/gh_${GH_VERSION}_linux_${arch}/bin/gh /usr/local/bin/gh; rm -rf /tmp/gh_*; \
    fi

ENV NO_UPDATE_NOTIFIER=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

COPY ael.tgz /tmp/ael.tgz
RUN if [ "$AEL_SOURCE" = npm ]; then npm i -g "ai-engineering-loop@${AEL_VERSION}"; else npm i -g /tmp/ael.tgz; fi >/dev/null 2>&1 && ael --version

COPY scenario.sh /usr/local/bin/ael-scenario
RUN chmod +x /usr/local/bin/ael-scenario
WORKDIR /work
