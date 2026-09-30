import express from 'express';
import "dotenv/config";
import { db } from './db/index.js';
import { links } from './db/schema.js';
import { eq } from 'drizzle-orm';
const app = express();
app.use(express.json());
const baseUrl = process.env.BASE_URL;
app.post("/create-link", async(req, res) => {
    const { originalUrl } = req.body;
    const shortLink = Math.random().toString(36).substring(2, 8);
    await db.insert(links).values({ originalUrl, shortLink });
    res.json({ shortLink: `${baseUrl}/${shortLink}`, message: "Short link created successfully" });
});

app.get('/:shortLink', async (req, res) => {
  const { shortLink } = req.params;
  console.log(shortLink);
  
  const link = await db.select().from(links).where(eq(links.shortLink, shortLink));
  console.log(link);
  
  const redirectLink = link[0];
  console.log(redirectLink);
  
  if (redirectLink) {
    res.redirect(redirectLink.originalUrl);
  } else {
    res.status(404).json({ message: "Link not found" });
  }
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});