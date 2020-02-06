FROM node:12.14.1-alpine3.11

ENV NODE_ENV production

WORKDIR /usr/src/app

COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]

RUN npm install --production && mv node_modules ../

COPY . .

EXPOSE 3002

CMD npm start