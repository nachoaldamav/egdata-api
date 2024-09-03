import { Hono } from 'hono';
import * as jwt from 'jsonwebtoken';
import { type IUser, User } from '../db/schemas/users.js';
import axios from 'axios';
import jwkToPem from 'jwk-to-pem';
import { epicStoreClient } from '../clients/epic.js';

const app = new Hono();

const googleOAuthClientID =
  process.env.GOOGLE_CLIENT_ID || 'your-google-client-id';

interface SimplifiedDiscordUser {
  id: string;
  displayName: string;
  avatar: string;
  avatarUrl: string;
  email: string;
  locale?: string;
  guilds?: Array<unknown>;
  accessToken: string;
  refreshToken: string;
  epicId: string | null;
}

async function getGooglePublicKey(kid: string) {
  const response = await axios.get(
    'https://www.googleapis.com/oauth2/v3/certs'
  );
  const key = response.data.keys.find((key: any) => key.kid === kid);

  if (!key) {
    throw new Error('Public key not found');
  }

  return jwkToPem(key);
}

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

app.post('/find-or-create', async (c) => {
  const body = await c.req.json<IUser>();
  const token = c.req.header('Authorization');

  if (!token) {
    return c.json({ error: 'Authorization header is required' }, 400);
  }

  try {
    const jwtToken = token.replace('Bearer ', '');

    const decodedHeader = jwt.decode(jwtToken, {
      complete: true,
    }) as unknown as jwt.JwtHeader & { header: { kid: string } };

    if (!decodedHeader || !decodedHeader.header.kid) {
      console.error('Invalid token header', {
        decodedHeader,
      });

      throw new Error('Invalid token header');
    }

    const publicKey = await getGooglePublicKey(decodedHeader.header.kid);

    const decodedToken = jwt.verify(jwtToken, publicKey, {
      algorithms: ['RS256'], // Google tokens are typically signed with RS256
    }) as { email: string; sub: string; iss: string; aud: string };

    // Verify issuer and audience
    const { email, sub, iss, aud } = decodedToken;

    if (
      iss !== 'https://accounts.google.com' &&
      iss !== 'accounts.google.com'
    ) {
      throw new Error('Invalid token issuer');
    }

    if (aud !== googleOAuthClientID) {
      throw new Error('Invalid token audience');
    }

    if (email !== body.email) {
      return c.json({ error: 'Email does not match' }, 400);
    }

    if (sub !== body.id) {
      return c.json({ error: 'ID does not match' }, 400);
    }

    // Find or create the user
    const user = await User.exists({ id: body.id });

    if (user) {
      const userDoc = await User.findOne({ id: body.id });
      return c.json(userDoc);
    }

    const newUser = new User(body);
    await newUser.save();

    return c.json(newUser);
  } catch (err) {
    console.error('Token verification failed', err);
    return c.json({ error: 'Invalid token' }, 400);
  }
});

app.get('/discord', async (c) => {
  const token = c.req.header('Authorization');

  if (!token) {
    return c.json({ error: 'Authorization header is required' }, 400);
  }

  try {
    const accessToken = token.replace('Bearer ', '');

    // Fetch user info from Discord
    const discordResponse = await axios.get(
      'https://discord.com/api/v10/oauth2/@me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const discordData = discordResponse.data.user;

    if (!discordData) {
      console.error('Discord user data not found');
      return c.json({ error: 'User information not found from Discord' }, 404);
    }

    const user = await User.exists({ id: discordData.id });

    if (user) {
      const userDoc = await User.findOne({ id: discordData.id });
      return c.json(userDoc);
    }

    return c.json({ error: 'User not found' }, 404);
  } catch (err) {
    console.error('Error fetching Discord user data', err);
    return c.json(
      { error: 'Failed to fetch user information from Discord' },
      400
    );
  }
});

app.post('/discord', async (c) => {
  const body = await c.req.json<SimplifiedDiscordUser>();
  const token = c.req.header('Authorization');

  if (!token) {
    console.error('Authorization header is required');
    return c.json({ error: 'Authorization header is required' }, 400);
  }

  try {
    const accessToken = token.replace('Bearer ', '');

    // Fetch user info from Discord
    const discordResponse = await axios.get(
      'https://discord.com/api/v10/oauth2/@me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    console.log('Discord response', discordResponse.data);

    const discordData = discordResponse.data.user as {
      id: string;
      username: string;
      avatar: string;
      discriminator: string;
      public_flags: number;
      flags: number;
      banner: any;
      accent_color: number;
      global_name: string;
      avatar_decoration_data: any;
      banner_color: string;
      clan: any;
    };

    if (!discordData) {
      return c.json({ error: 'User information not found from Discord' }, 404);
    }

    if (discordData.id !== body.id) {
      console.error('ID does not match', {
        discordData,
        body,
      });
      return c.json({ error: 'ID does not match' }, 400);
    }

    // Find or create the user
    const user = await User.exists({ id: discordData.id });

    if (user) {
      const userDoc = await User.findOne({ id: discordData.id });
      return c.json(userDoc);
    }

    const newUser = new User(body);
    await newUser.save();

    return c.json(newUser);
  } catch (err) {
    console.error('Error fetching Discord user data', err);
    return c.json(
      { error: 'Failed to fetch user information from Discord' },
      400
    );
  }
});

app.put('/epic', async (c) => {
  const token = c.req.header('Authorization');
  const id = c.req.query('id');

  if (!token) {
    console.error('Authorization header is required');
    return c.json({ error: 'Authorization header is required' }, 400);
  }

  if (!id) {
    console.error('ID query parameter is required');
    return c.json({ error: 'ID query parameter is required' }, 400);
  }

  try {
    const accessToken = token.replace('Bearer ', '');

    // Fetch user ID from Discord
    const discordResponse = await axios.get(
      'https://discord.com/api/v10/oauth2/@me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const discordData = discordResponse.data.user;

    if (!discordData) {
      console.error('Discord user data not found');
      return c.json({ error: 'User information not found from Discord' }, 404);
    }

    const user = await User.exists({ id: discordData.id });

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    const epicProfile = await epicStoreClient.getUser(id);

    if (!epicProfile) {
      return c.json({ error: 'Epic user not found' }, 404);
    }

    const userDoc = await User.findOne({ id: discordData.id });

    if (!userDoc) {
      return c.json({ error: 'User not found' }, 404);
    }

    userDoc.epicId = epicProfile.epicAccountId;

    await userDoc.save();

    return c.json({
      success: true,
    });
  } catch (err) {
    console.error('Error fetching Epic user data', err);
    return c.json(
      { error: 'Failed to fetch user information from Epic Games' },
      400
    );
  }
});

app.delete('/epic', async (c) => {
  const token = c.req.header('Authorization');

  if (!token) {
    console.error('Authorization header is required');
    return c.json({ error: 'Authorization header is required' }, 400);
  }

  try {
    const accessToken = token.replace('Bearer ', '');

    // Fetch user ID from Discord
    const discordResponse = await axios.get(
      'https://discord.com/api/v10/oauth2/@me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const discordData = discordResponse.data.user;

    if (!discordData) {
      console.error('Discord user data not found');
      return c.json({ error: 'User information not found from Discord' }, 404);
    }

    const user = await User.exists({ id: discordData.id });

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    const userDoc = await User.findOne({ id: discordData.id });

    if (!userDoc) {
      return c.json({ error: 'User not found' }, 404);
    }

    userDoc.epicId = null;

    await userDoc.save();

    return c.json({
      success: true,
    });
  } catch (err) {
    console.error('Error fetching Epic user data', err);
    return c.json(
      { error: 'Failed to fetch user information from Epic Games' },
      400
    );
  }
});

app.get('/check-epic', async (c) => {
  const id = c.req.query('id');

  if (!id) {
    return c.json({ error: 'ID query parameter is required' }, 400);
  }

  try {
    // Check if the ID is already associated with an Epic account
    const user = await User.findOne({ epicId: id });

    if (user) {
      return c.json({ error: 'Epic account already associated' }, 400);
    }

    const profile = await epicStoreClient.getUser(id);

    if (profile) {
      return c.json({ profile });
    }

    return c.json({ message: 'Epic account does not exist' }, 404);
  } catch (err) {
    console.error('Error checking Epic account', err);
    return c.json({ error: 'Failed to check Epic account' }, 400);
  }
});

export default app;
