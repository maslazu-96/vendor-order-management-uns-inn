FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY public ./public
COPY src ./src
RUN mkdir -p /app/data
ENV PORT=3000
EXPOSE 3000
CMD ["npm","start"]
