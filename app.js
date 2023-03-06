const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(4000, () => {
      console.log("Server is Running at http://localhost:4000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

// AUTHENTICATION TOKEN
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "my_secret_token", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// REGISTER USER API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `INSERT INTO user(username, name, password, gender)
                VALUES('${username}', '${name}', '${hashPassword}', '${gender}');`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// LOGIN USER API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "my_secret_token");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// GET LATEST TWEETS WHOM USER FOLLOWS 4 TWEET AT A TIME API
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const {
    offset = 0,
    limit = 4,
    order = "DESC",
    order_by = "dateTime",
  } = request.body;
  getTweetsQuery = `SELECT username, tweet, date_time AS dateTime
        FROM user INNER JOIN follower ON user.user_id = follower.following_user_id
        INNER JOIN tweet ON follower.following_user_id = tweet.user_id
        ORDER BY ${order_by} ${order}
        LIMIT ${limit}
        OFFSET ${offset};`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// GET ALL NAMES OF THE USER WHOM USER FOLLOWS API
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(getUserIdQuery);

  const getUsernameQuery = `SELECT DISTINCT name FROM user INNER JOIN follower
        ON user.user_id = follower.follower_user_id AND user.user_id != ${userId.user_id};`;
  const names = await db.all(getUsernameQuery);
  response.send(names);
});

// GET NAMES OF USER WHO FOLLOW USER API
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(getUserIdQuery);

  const getUserQuery = `SELECT DISTINCT name FROM user INNER JOIN follower
          ON user.user_id = follower.following_user_id AND user.user_id != ${userId.user_id};`;
  const names = await db.all(getUserQuery);
  response.send(names);
});

// GET TWEET OF USER WHOM USER FOLLOWING
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(getUserIdQuery);

  const tweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId};`;
  const tweet = await db.get(tweetQuery);
  if (tweet === undefined) {
    response.status(404);
    response.send("Invalid tweet id");
  } else {
    const getAllFollowersQuery = `SELECT * FROM follower INNER JOIN user
        ON user.user_id = follower.following_user_id
        WHERE follower.follower_user_id = ${userId.user_id};`;

    const userFollowers = await db.all(getAllFollowersQuery);

    if (
      userFollowers.some((item) => item.following_user_id === tweet.user_id)
    ) {
      const getTweetDetailsQuery = `SELECT DISTINCT(tweet), 
        COUNT(DISTINCT like.like_id) AS likes, 
        COUNT(DISTINCT reply.reply) AS replies, 
        date_time AS dateTime
        FROM tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
        INNER JOIN like ON reply.tweet_id = like.tweet_id 
        WHERE tweet.tweet_id = ${tweetId}
        Group by tweet.tweet_id;`;
      const tweetInfo = await db.get(getTweetDetailsQuery);
      response.send(tweetInfo);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
});

// GET LIST OF USER WHOM LIKE THE TWEET
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserIdQuery = `SELECT user_id 
        FROM user
        WHERE username = '${username}';`;
    const userId = await db.get(getUserIdQuery);
    const tweetQuery = `SELECT * FROM tweet 
        WHERE tweet_id = ${tweetId};`;
    const tweet = await db.get(tweetQuery);
    if (tweet === undefined) {
      response.status(404);
      response.send("Invalid tweet id");
    } else {
      getAllFollowersQuery = `SELECT *
            FROM follower
            INNER JOIN user
            ON user.user_id = follower.following_user_id
            WHERE follower.follower_user_id = ${userId.user_id};`;
      const allFollowers = await db.all(getAllFollowersQuery);

      if (
        allFollowers.some((item) => item.following_user_id === tweet.user_id)
      ) {
        const getFollowersNameQuery = `SELECT username FROM tweet
            INNER JOIN like
            ON tweet.tweet_id = like.tweet_id
            INNER JOIN user 
            ON like.user_id = user.user_id
            WHERE tweet.tweet_id = ${tweetId} 
            AND user.username != '${username}';`;
        const users = await db.all(getFollowersNameQuery);
        response.send({
          likes: users.map((each) => each.username),
        });
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    }
  }
);

// GET LIST OF REPLY API
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserIdQuery = `SELECT user_id 
        FROM user
        WHERE username = '${username}';`;
    const userId = await db.get(getUserIdQuery);
    const tweetQuery = `SELECT * FROM tweet 
        WHERE tweet_id = ${tweetId};`;
    const tweet = await db.get(tweetQuery);
    if (tweet === undefined) {
      response.status(404);
      response.send("Invalid tweet id");
    } else {
      getAllFollowersQuery = `SELECT *
            FROM follower
            INNER JOIN user
            ON user.user_id = follower.following_user_id
            WHERE follower.follower_user_id = ${userId.user_id};`;
      const allFollowers = await db.all(getAllFollowersQuery);

      if (
        allFollowers.some((item) => item.following_user_id === tweet.user_id)
      ) {
        const getReplyNameQuery = `SELECT name, reply FROM tweet
            INNER JOIN reply
            ON tweet.tweet_id = reply.tweet_id
            INNER JOIN user 
            ON reply.user_id = user.user_id
            WHERE tweet.tweet_id = ${tweetId};`;
        const reply = await db.all(getReplyNameQuery);
        response.send({
          replies: reply.map((each) => {
            return {
              name: each.name,
              reply: each.reply,
            };
          }),
        });
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    }
  }
);

// GET ALL TWEETS OF THE USER
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  const userTweetsDetailsQuery = `SELECT DISTINCT tweet.tweet, COUNT(DISTINCT like.like_id) AS likes, COUNT(DISTINCT reply.reply_id) AS replies, tweet.date_time AS dateTime FROM tweet
        INNER JOIN like
        ON tweet.tweet_id = like.tweet_id
        INNER JOIN reply 
        ON like.tweet_id = reply.tweet_id
        WHERE tweet.user_id = ${userId.user_id}
        GROUP BY tweet.tweet_id;`;
  const userTweetsDetail = await db.all(userTweetsDetailsQuery);
  response.send(userTweetsDetail);
});

// POST TWEET API
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const userId = await db.get(getUserIdQuery);
  const addTweetQuery = `INSERT INTO tweet(tweet)
        VALUES('${tweet}');`;
  await db.run(addTweetQuery);
  response.send("Created a Tweet");
});

// DELETE USERS TWEETS API
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
    const userId = await db.get(getUserIdQuery);
    const tweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId};`;
    const tweet = await db.get(tweetQuery);
    if (userId.user_id === tweet.user_id) {
      const deleteQuery = `DELETE FROM tweet
        WHERE user_id = ${userId.user_id};`;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
