FROM node:9.11.1-slim


WORKDIR /opt/app
ADD . /opt/app

ENV NODE_ENV docker

RUN npm install --production

EXPOSE 7777

ENTRYPOINT ["node"]

CMD ["server.js"]