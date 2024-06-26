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
        authMechanism: 'MONGODB-X509',
        authSource: '$external',
        tlsCAFile: process.env['MONGO_CA'],
        tls: true,
        tlsCertificateKeyFile: process.env['MONGO_CERT'],
      }
    );
    console.log('Connected to MongoDB');
  }

  async disconnect() {
    await this.db.close();
  }
}
