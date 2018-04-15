FROM ubuntu:12.04

RUN echo "deb http://archive.ubuntu.com/ubuntu precise main universe" > /etc/apt/sources.list
RUN add-apt-repository -y ppa:chris-lea/node.js
RUN apt-get update
RUN apt-get -y install libc6-dev build-essential python-software-properties nodejs

WORKDIR /opt/app
ADD . /opt/app

ENV NODE_ENV docker

RUN npm install --production

EXPOSE 7777

ENTRYPOINT ["node"]

CMD ["server.js"]