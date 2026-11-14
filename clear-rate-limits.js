import 'dotenv/config';
import mongoose from 'mongoose';

async function clearRateLimits() {
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await mongoose.connection.collection('ratelimitentries').deleteMany({});
  console.log('Deleted rate limit records:', result.deletedCount);
  await mongoose.disconnect();
}

clearRateLimits().catch(console.error);

