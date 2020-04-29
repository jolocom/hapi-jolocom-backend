FROM node:10.15
MAINTAINER Jolocom <dev@jolocom.io>

# Create Directory for the Container
WORKDIR /usr/src/app

# Only copy the package.json and yarn.lock to work directory
COPY package.json .
COPY yarn.lock .
# Install all Packages (can build now because config is JSON not TS)
RUN yarn install && yarn build

# Copy all other source code to work directory
ADD . /usr/src/app

EXPOSE 9000

CMD yarn server
