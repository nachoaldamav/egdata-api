import mongoose from 'mongoose';

export class DB {
  db: mongoose.Connection;
  constructor() {
    this.db = mongoose.connection;
  }

  async connect() {
    await mongoose.connect(
      `mongodb://${process.env['MONGO_URL']}:27017/egdata`,
      {
        auth: {
          username: process.env['MONGO_USER'],
          password: process.env['MONGO_PASS'],
        },
        // tlsCAFile: process.env['MONGO_CA'],
        // tls: true,
        // cert: process.env['MONGO_CERT'],
      }
    );
    console.log('Connected to MongoDB');
  }

  async disconnect() {
    await this.db.close();
  }
}
