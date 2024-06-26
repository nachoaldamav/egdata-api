import mongoose from 'mongoose';

export class DB {
  db: mongoose.Connection;
  constructor() {
    this.db = mongoose.connection;
  }

  async connect() {
    console.log('Connecting to MongoDB', {
      url: process.env['MONGO_URL'],
      ca: process.env['MONGO_CA']?.substring(0, 100),
      cert: process.env['MONGO_CERT']?.substring(0, 100),
    });

    await mongoose.connect(
      `mongodb://${process.env['MONGO_URL']}:27017/egdata`,
      {
        authMechanism: 'MONGODB-X509',
        authSource: '$external',
        tlsCAFile: process.env['MONGO_CA'],
        tlsCertificateKeyFile: process.env['MONGO_CERT'],
        tls: true,
        tlsAllowInvalidCertificates: true,
      }
    );
    console.log('Connected to MongoDB');
  }

  async disconnect() {
    await this.db.close();
  }
}
