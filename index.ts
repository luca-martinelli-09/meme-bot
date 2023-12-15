import { Meme, PrismaClient } from "@prisma/client";
import express, { Request, Response } from "express";
import TelegramBot, { ChosenInlineResult, InlineQuery, InlineQueryResultPhoto, Message } from "node-telegram-bot-api";
import _ from "lodash";
import path from "path";

const prisma = new PrismaClient();

const TOKEN = process.env.TELEGRAM_TOKEN || "";
const URL = process.env.BASE_URL || "http://localhost";

const bot = new TelegramBot(TOKEN);

const app = express();

app.use(express.static("../public"));
app.set("view engine", "ejs");
app.set("../views", path.join(__dirname, "views"));

bot.setWebHook(`${URL}/bot${TOKEN}`);

app.use(express.json());

app.post(`/bot${TOKEN}`, (req: Request, res: Response) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", async (req: Request, res: Response) => {
  const noTriggers = req.query.noTrigger;

  let memes: Meme[] = [];

  if (noTriggers === "1")
    memes = await prisma.$queryRaw`SELECT DISTINCT Memes.* FROM Memes
                     LEFT JOIN MemeTriggers ON MemeTriggers.MemeID = Memes.MemeID
                     WHERE MemeTriggers.MemeID IS NULL`;
  else
    memes = await prisma.meme.findMany({
      orderBy: {
        Citato: "desc",
      },
    });

  res.render("index.ejs", {
    totalMemes: memes.length,
    memes: memes,
  });
});

app.listen(3000, () => {
  console.log("Started!");
});

// UTILS FUNCTIONS

function triggerize(text: string) {
  return _.kebabCase(text.toLowerCase()).replaceAll("-", " ");
}

function isGroup(msg: Message) {
  return msg.chat.type === "group" || msg.chat.type === "supergroup";
}

function sendNeedGroup(msg: Message) {
  bot.sendMessage(msg.chat.id, "Per usare questo bot devi essere in un gruppo!");
}

// BOT

bot.onText(/\/start/, async (msg: Message) => {
  bot.sendMessage(msg.chat.id, `Aggiungi questo bot a un gruppo per citare i meme. Creato da @LucaMartinelli09`);
});

bot.on("message", async (msg: Message) => {
  if (!isGroup(msg)) return sendNeedGroup(msg);

  const group = { GroupID: msg.chat.id, GroupName: msg.chat.title, GroupLink: msg.chat.invite_link };
  await prisma.group.upsert({
    where: {
      GroupID: group.GroupID,
    },
    create: { ...group },
    update: { ...group },
  });

  if (!msg.text) return;

  const memeTrigger = triggerize(msg.text);
  const memes = (await prisma.$queryRaw`SELECT DISTINCT Memes.* FROM MemeTriggers JOIN Memes ON MemeTriggers.MemeID = Memes.MemeID
                                          WHERE ${memeTrigger} LIKE MemeTriggers.MemeTrigger`) as Meme[];

  const meme = memes.at(0);
  if (!meme) return;

  await prisma.meme.update({
    where: {
      MemeID: meme.MemeID,
    },
    data: {
      Citato: { increment: 1 },
    },
  });

  await prisma.group.update({
    where: {
      GroupID: msg.chat.id,
    },
    data: {
      MemeCitati: { increment: 1 },
    },
  });

  bot.sendPhoto(msg.chat.id, process.env.BASE_URL + "/" + meme.ImagePath, {
    reply_to_message_id: msg.message_id,
  });
});

bot.on("inline_query", async (query: InlineQuery) => {
  const memeTrigger = triggerize(query.query);

  const memes = (await prisma.$queryRaw`SELECT DISTINCT Memes.* FROM MemeTriggers JOIN Memes ON MemeTriggers.MemeID = Memes.MemeID
                                          WHERE ${memeTrigger} LIKE MemeTriggers.MemeTrigger OR LOWER(Memes.Name) LIKE ${"%" + memeTrigger + "%"}`) as Meme[];

  bot.answerInlineQuery(
    query.id,
    memes.map(
      (meme: Meme) =>
        ({
          type: "photo",
          id: meme.MemeID,
          title: meme.Name,
          thumb_url: process.env.BASE_URL + "/" + meme.ImagePath,
          photo_url: process.env.BASE_URL + "/" + meme.ImagePath,
          caption: meme.Name,
        } as InlineQueryResultPhoto)
    ),
    {
      cache_time: 120,
    }
  );
});

bot.on("chosen_inline_result", (result: ChosenInlineResult) => {
  prisma.meme.update({
    where: {
      MemeID: result.result_id,
    },
    data: {
      Citato: { increment: 1 },
    },
  });
});
