module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: process.env.PORT || 7777,

  keyLength: 10,

  maxLength: 400000,

  staticMaxAge: 86400,

  recompressStaticAssets: true,

  logging: [
    {
      level: "verbose",
      type: "Console",
      colorize: true
    }
  ],

  keyGenerator: {
    type: "phonetic"
  },

  storage: {
    type: "postgres",
  },

  documents: {
    about: "./about.md"
  }
};
