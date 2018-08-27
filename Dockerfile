FROM node:9.11.1

# build highlightjs
RUN git clone git@github.com:meseta/highlight.js.git /hljs_build
WORKDIR /hljs_build

RUN npm install
RUN node tools/build.js -n cpp css glsl gml javascript json xml markdown python ruby yaml
RUN cp /hljs_build/build/highlight.pack.js /opt/app/static/highlight.pack.js

# build haste
WORKDIR /opt/app
ADD . /opt/app

ENV NODE_ENV docker

RUN npm install --production

EXPOSE 7777

ENTRYPOINT ["node"]

CMD ["server.js"]