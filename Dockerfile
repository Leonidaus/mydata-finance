# One image for the demo: the API and the built web app, served from one origin.
#
# The database is not in the image (it is large and built from data that is not in the
# repository). Mount the directory that holds it at /data:
#
#   docker build -t mydata-finance .
#   docker run --rm -p 8787:8787 -v "$PWD/data/out:/data:ro" mydata-finance
#
# See "Deploy" in the README for building a small database to ship.

FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/app/package.json packages/app/
COPY packages/backend/package.json packages/backend/
COPY packages/infra/package.json packages/infra/
RUN npm ci --no-audit --no-fund
COPY packages packages
# The app calls the API on its own origin in this image.
ENV VITE_DATA_SOURCE=api
RUN npm run build

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=8787 \
    FINANCE_DB=/data/finance.sqlite \
    STATIC_DIR=/repo/packages/app/dist
COPY --from=build /repo/package.json /repo/package-lock.json /repo/.npmrc /repo/tsconfig.base.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/packages/backend packages/backend
COPY --from=build /repo/packages/app/dist packages/app/dist
EXPOSE 8787
USER node
CMD ["npm", "run", "start", "-w", "@mydata/backend"]
