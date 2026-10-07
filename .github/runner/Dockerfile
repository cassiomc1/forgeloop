FROM node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b

ARG RUNNER_VERSION=2.337.0
ARG RUNNER_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613

RUN mkdir -p /opt/actions-runner /opt/forgeloop-ci \
    && curl --fail --location --retry 3 \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
      --output /tmp/runner.tar.gz \
    && echo "${RUNNER_SHA256}  /tmp/runner.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/runner.tar.gz -C /opt/actions-runner \
    && /opt/actions-runner/bin/installdependencies.sh \
    && rm /tmp/runner.tar.gz \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/ci-runner-admission.mjs /opt/forgeloop-ci/admission.mjs
COPY .github/runner/linux-admission.sh /opt/forgeloop-ci/linux-admission.sh
RUN chmod 700 /opt/forgeloop-ci/linux-admission.sh

ENV RUNNER_ALLOW_RUNASROOT=1 \
    ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/forgeloop-ci/linux-admission.sh
WORKDIR /opt/actions-runner
CMD ["./run.sh"]
