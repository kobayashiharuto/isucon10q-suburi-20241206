"use strict";

const tracer = require('dd-trace');

tracer.init({
    logInjection: true,
    runtimeMetrics: true,
    profiling: true,
    service: 'isuumo',
});

const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 60 }); // TTL: 60秒

// キャッシュミドルウェア
const cacheMiddleware = (req, res, next) => {
  const cacheKey = `${req.path}?${JSON.stringify(req.query)}`;
  const cachedResponse = cache.get(cacheKey);
  
  if (cachedResponse) {
    return res.json(cachedResponse); // キャッシュから返却
  }

  res.sendResponse = res.json; // 元の res.json を保存
  res.json = (body) => {
    cache.set(cacheKey, body); // キャッシュに保存
    res.sendResponse(body); // 元のレスポンスを送信
  };

  next();
};


const express = require("express");
const morgan = require("morgan");
const multer = require("multer");
const mysql = require("mysql");
const path = require("path");
const cp = require("child_process");
const util = require("util");
const os = require("os");
const parse = require("csv-parse/lib/sync");
const camelcaseKeys = require("camelcase-keys");
const upload = multer();
const promisify = util.promisify;
const exec = promisify(cp.exec);
const chairSearchCondition = require("../fixture/chair_condition.json");
const estateSearchCondition = require("../fixture/estate_condition.json");

const PORT = process.env.PORT ?? 1323;
const LIMIT = 20;
const NAZOTTE_LIMIT = 50;
const dbinfo = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: process.env.MYSQL_PORT ?? 3306,
  user: process.env.MYSQL_USER ?? "isucon",
  password: process.env.MYSQL_PASS ?? "isucon",
  database: process.env.MYSQL_DBNAME ?? "isuumo",
  connectionLimit: 10,
};

const app = express();
const db = mysql.createPool(dbinfo);
app.set("db", db);

app.use(morgan("combined"));
app.use(express.json());
app.post("/initialize", async (req, res, next) => {
  try {
    const dbdir = path.resolve("..", "mysql", "db");
    const dbfiles = [
      "0_Schema.sql",
      "1_DummyEstateData.sql",
      "2_DummyChairData.sql",
    ];
    const execfiles = dbfiles.map((file) => path.join(dbdir, file));
    for (const execfile of execfiles) {
      await exec(
        `mysql -h ${dbinfo.host} -u ${dbinfo.user} -p${dbinfo.password} -P ${dbinfo.port} ${dbinfo.database} < ${execfile}`
      );
    }
    res.json({
      language: "nodejs",
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/estate/low_priced", async (req, res, next) => {
  const cacheKey = "low_priced_estate";
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    // キャッシュが存在する場合
    return res.json({ estates: cachedData });
  }

  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));

  try {
    const es = await query(
      "SELECT * FROM estate ORDER BY rent ASC, id ASC LIMIT ?",
      [LIMIT]
    );
    const estates = es.map((estate) => camelcaseKeys(estate));

    // キャッシュに保存
    cache.set(cacheKey, estates);

    res.json({ estates });
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});

app.get("/api/chair/low_priced", async (req, res, next) => {
  const cacheKey = "low_priced_chair";
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    // キャッシュが存在する場合
    return res.json({ chairs: cachedData });
  }

  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));

  try {
    const cs = await query(
      "SELECT * FROM chair WHERE stock > 0 ORDER BY price ASC, id ASC LIMIT ?",
      [LIMIT]
    );
    const chairs = cs.map((chair) => camelcaseKeys(chair));

    // キャッシュに保存
    cache.set(cacheKey, chairs);

    res.json({ chairs });
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});


app.get("/api/chair/search", async (req, res, next) => {
  const searchQueries = [];
  const queryParams = [];
  const {
    priceRangeId,
    heightRangeId,
    widthRangeId,
    depthRangeId,
    kind,
    color,
    features,
    page,
    perPage,
  } = req.query;

  if (!!priceRangeId) {
    const chairPrice = chairSearchCondition["price"].ranges[priceRangeId];
    if (chairPrice == null) {
      res.status(400).send("priceRangeID invalid");
      return;
    }

    if (chairPrice.min !== -1) {
      searchQueries.push("price >= ? ");
      queryParams.push(chairPrice.min);
    }

    if (chairPrice.max !== -1) {
      searchQueries.push("price < ? ");
      queryParams.push(chairPrice.max);
    }
  }

  if (!!heightRangeId) {
    const chairHeight = chairSearchCondition["height"].ranges[heightRangeId];
    if (chairHeight == null) {
      res.status(400).send("heightRangeId invalid");
      return;
    }

    if (chairHeight.min !== -1) {
      searchQueries.push("height >= ? ");
      queryParams.push(chairHeight.min);
    }

    if (chairHeight.max !== -1) {
      searchQueries.push("height < ? ");
      queryParams.push(chairHeight.max);
    }
  }

  if (!!widthRangeId) {
    const chairWidth = chairSearchCondition["width"].ranges[widthRangeId];
    if (chairWidth == null) {
      res.status(400).send("widthRangeId invalid");
      return;
    }

    if (chairWidth.min !== -1) {
      searchQueries.push("width >= ? ");
      queryParams.push(chairWidth.min);
    }

    if (chairWidth.max !== -1) {
      searchQueries.push("width < ? ");
      queryParams.push(chairWidth.max);
    }
  }

  if (!!depthRangeId) {
    const chairDepth = chairSearchCondition["depth"].ranges[depthRangeId];
    if (chairDepth == null) {
      res.status(400).send("depthRangeId invalid");
      return;
    }

    if (chairDepth.min !== -1) {
      searchQueries.push("depth >= ? ");
      queryParams.push(chairDepth.min);
    }

    if (chairDepth.max !== -1) {
      searchQueries.push("depth < ? ");
      queryParams.push(chairDepth.max);
    }
  }

  if (!!kind) {
    searchQueries.push("kind = ? ");
    queryParams.push(kind);
  }

  if (!!color) {
    searchQueries.push("color = ? ");
    queryParams.push(color);
  }

  if (!!features) {
    const featureConditions = features.split(",");
    for (const featureCondition of featureConditions) {
      searchQueries.push("features LIKE CONCAT('%', ?, '%')");
      queryParams.push(featureCondition);
    }
  }

  if (searchQueries.length === 0) {
    res.status(400).send("Search condition not found");
    return;
  }

  searchQueries.push("stock > 0");

  if (!page || page != +page) {
    res.status(400).send(`page condition invalid ${page}`);
    return;
  }

  if (!perPage || perPage != +perPage) {
    res.status(400).send("perPage condition invalid");
    return;
  }

  const pageNum = parseInt(page, 10);
  const perPageNum = parseInt(perPage, 10);

  const sqlprefix = "SELECT * FROM chair WHERE ";
  const searchCondition = searchQueries.join(" AND ");
  const limitOffset = " ORDER BY popularity sort_key DESC LIMIT ? OFFSET ?";
  const countprefix = "SELECT COUNT(*) as count FROM chair WHERE ";

  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));
  try {
    const [{ count }] = await query(
      `${countprefix}${searchCondition}`,
      queryParams
    );
    queryParams.push(perPageNum, perPageNum * pageNum);
    const chairs = await query(
      `${sqlprefix}${searchCondition}${limitOffset}`,
      queryParams
    );
    res.json({
      count,
      chairs: camelcaseKeys(chairs),
    });
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});

app.get("/api/chair/search/condition", (req, res, next) => {
  res.json(chairSearchCondition);
});

app.get("/api/chair/:id", async (req, res, next) => {
  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));
  try {
    const id = req.params.id;
    const [chair] = await query("SELECT * FROM chair WHERE id = ?", [id]);
    if (chair == null || chair.stock <= 0) {
      res.status(404).send("Not Found");
      return;
    }
    res.json(camelcaseKeys(chair));
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});

app.post("/api/chair/buy/:id", async (req, res, next) => {
  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const beginTransaction = promisify(connection.beginTransaction.bind(connection));
  const query = promisify(connection.query.bind(connection));
  const commit = promisify(connection.commit.bind(connection));
  const rollback = promisify(connection.rollback.bind(connection));
  try {
    const id = req.params.id;
    await beginTransaction();
    const [
      chair,
    ] = await query(
      "SELECT * FROM chair WHERE id = ? AND stock > 0 FOR UPDATE",
      [id]
    );
    if (chair == null) {
      res.status(404).send("Not Found");
      await rollback();
      return;
    }
    await query("UPDATE chair SET stock = ? WHERE id = ?", [
      chair.stock - 1,
      id,
    ]);
    await commit();
    res.json({ ok: true });
  } catch (e) {
    await rollback();
    next(e);
  } finally {
    await connection.release();
  }
});

app.get("/api/estate/search", cacheMiddleware, async (req, res, next) => {
  const searchQueries = [];
  const queryParams = [];
  const {
    doorHeightRangeId,
    doorWidthRangeId,
    rentRangeId,
    features,
    page,
    perPage,
  } = req.query;

  if (!!doorHeightRangeId) {
    const doorHeight =
      estateSearchCondition["doorHeight"].ranges[doorHeightRangeId];
    if (doorHeight == null) {
      res.status(400).send("doorHeightRangeId invalid");
      return;
    }

    if (doorHeight.min !== -1) {
      searchQueries.push("door_height >= ? ");
      queryParams.push(doorHeight.min);
    }

    if (doorHeight.max !== -1) {
      searchQueries.push("door_height < ? ");
      queryParams.push(doorHeight.max);
    }
  }

  if (!!doorWidthRangeId) {
    const doorWidth =
      estateSearchCondition["doorWidth"].ranges[doorWidthRangeId];
    if (doorWidth == null) {
      res.status(400).send("doorWidthRangeId invalid");
      return;
    }

    if (doorWidth.min !== -1) {
      searchQueries.push("door_width >= ? ");
      queryParams.push(doorWidth.min);
    }

    if (doorWidth.max !== -1) {
      searchQueries.push("door_width < ? ");
      queryParams.push(doorWidth.max);
    }
  }

  if (!!rentRangeId) {
    const rent = estateSearchCondition["rent"].ranges[rentRangeId];
    if (rent == null) {
      res.status(400).send("rentRangeId invalid");
      return;
    }

    if (rent.min !== -1) {
      searchQueries.push("rent >= ? ");
      queryParams.push(rent.min);
    }

    if (rent.max !== -1) {
      searchQueries.push("rent < ? ");
      queryParams.push(rent.max);
    }
  }

  if (!!features) {
    const featureConditions = features.split(",");
    for (const featureCondition of featureConditions) {
      searchQueries.push("features LIKE CONCAT('%', ?, '%')");
      queryParams.push(featureCondition);
    }
  }

  if (searchQueries.length === 0) {
    res.status(400).send("Search condition not found");
    return;
  }

  if (!page || page != +page) {
    res.status(400).send(`page condition invalid ${page}`);
    return;
  }

  if (!perPage || perPage != +perPage) {
    res.status(400).send("perPage condition invalid");
    return;
  }

  const pageNum = parseInt(page, 10);
  const perPageNum = parseInt(perPage, 10);

  const sqlprefix = "SELECT * FROM estate WHERE ";
  const searchCondition = searchQueries.join(" AND ");
  const limitOffset = " ORDER BY popularity DESC, id ASC LIMIT ? OFFSET ?";
  const countprefix = "SELECT COUNT(*) as count FROM estate WHERE ";

  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));
  try {
    const [{ count }] = await query(
      `${countprefix}${searchCondition}`,
      queryParams
    );
    queryParams.push(perPageNum, perPageNum * pageNum);
    const estates = await query(
      `${sqlprefix}${searchCondition}${limitOffset}`,
      queryParams
    );
    res.json({
      count,
      estates: camelcaseKeys(estates),
    });
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});

app.get("/api/estate/search/condition", (req, res, next) => {
  res.json(estateSearchCondition);
});

app.post("/api/estate/req_doc/:id", async (req, res, next) => {
  const id = req.params.id;
  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));
  try {
    const id = req.params.id;
    const [estate] = await query("SELECT * FROM estate WHERE id = ?", [id]);
    if (estate == null) {
      res.status(404).send("Not Found");
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});
app.post("/api/estate/nazotte", async (req, res, next) => {
  const coordinates = req.body.coordinates; // {latitude, longitude} の配列

  // ポリゴンWKTの生成
  // POLYGON((x1 y1,x2 y2,...,xN yN,x1 y1)) で閉じる必要がある
  // フロント側で閉じたポリゴンを渡していると仮定し、ここではそのまま使用
  let polygonCoords = coordinates.map(c => `${c.longitude} ${c.latitude}`).join(',');

  // coordinatesが閉じていない場合は、以下のような処理で始点を終点として追加
  // if (
  //   coordinates[0].longitude !== coordinates[coordinates.length - 1].longitude ||
  //   coordinates[0].latitude !== coordinates[coordinates.length - 1].latitude
  // ) {
  //   polygonCoords += `,${coordinates[0].longitude} ${coordinates[0].latitude}`;
  // }

  const polygonWKT = `POLYGON((${polygonCoords}))`;

  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));
  
  try {
    // locationカラムはPOINT型で、SPATIAL INDEXが貼られているため
    // ST_Containsで直接空間検索可能
    const sql = `
      SELECT *
      FROM estate
      WHERE ST_Contains(
        ST_PolygonFromText(?),
        location
      )
      ORDER BY popularity DESC, id ASC
      LIMIT ?
    `;

    const estatesInPolygon = await query(sql, [polygonWKT, NAZOTTE_LIMIT]);

    const results = {
      estates: estatesInPolygon.map(e => camelcaseKeys(e)),
      count: estatesInPolygon.length
    };

    res.json(results);
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});

app.get("/api/estate/:id", async (req, res, next) => {
  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));
  try {
    const id = req.params.id;
    const [estate] = await query("SELECT * FROM estate WHERE id = ?", [id]);
    if (estate == null) {
      res.status(404).send("Not Found");
      return;
    }

    res.json(camelcaseKeys(estate));
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});

app.get("/api/recommended_estate/:id", async (req, res, next) => {
  const id = req.params.id;
  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));
  try {
    // 椅子情報を取得
    const [chair] = await query("SELECT * FROM chair WHERE id = ?", [id]);
    const dimensions = [chair.width, chair.height, chair.depth].sort((a, b) => a - b); // 小さい順にソート
    const min1 = dimensions[0]; // 最小値
    const min2 = dimensions[1]; // 2番目に小さい値

    // 不動産物件を検索
    const es = await query(
      `
      SELECT * FROM estate 
      WHERE 
        (door_width >= ? AND door_height >= ?) OR 
        (door_width >= ? AND door_height >= ?)
      ORDER BY popularity DESC
      LIMIT ?`,
      [min1, min2, min2, min1, LIMIT]
    );

    // 結果を整形
    const estates = es.map((estate) => camelcaseKeys(estate));

    // JSONレスポンスを返却
    res.json({ estates });
  } catch (e) {
    next(e);
  } finally {
    await connection.release();
  }
});



app.post("/api/chair", upload.single("chairs"), async (req, res, next) => {
  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const beginTransaction = promisify(connection.beginTransaction.bind(connection));
  const query = promisify(connection.query.bind(connection));
  const commit = promisify(connection.commit.bind(connection));
  const rollback = promisify(connection.rollback.bind(connection));

  try {
    await beginTransaction();
    const csv = parse(req.file.buffer, { skip_empty_line: true });
    for (var i = 0; i < csv.length; i++) {
      const items = csv[i];
      await query(
        "INSERT INTO chair(id, name, description, thumbnail, price, height, width, depth, color, features, kind, popularity, stock) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        items
      );
    }
    await commit();

    // キャッシュをクリア
    cache.flushAll();

    res.status(201);
    res.json({ ok: true });
  } catch (e) {
    await rollback();
    next(e);
  } finally {
    await connection.release();
  }
});

app.post("/api/estate", upload.single("estates"), async (req, res, next) => {
  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const beginTransaction = promisify(connection.beginTransaction.bind(connection));
  const query = promisify(connection.query.bind(connection));
  const commit = promisify(connection.commit.bind(connection));
  const rollback = promisify(connection.rollback.bind(connection));

  try {
    await beginTransaction();
    const csv = parse(req.file.buffer, { skip_empty_line: true });
    for (var i = 0; i < csv.length; i++) {
      const items = csv[i];
      await query(
        "INSERT INTO estate(id, name, description, thumbnail, address, latitude, longitude, rent, door_height, door_width, features, popularity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        items
      );
    }
    await commit();

    // キャッシュをクリア
    cache.flushAll();

    res.status(201);
    res.json({ ok: true });
  } catch (e) {
    await rollback();
    next(e);
  } finally {
    await connection.release();
  }
});

app.listen(PORT, () => {
  console.log(`Listening ${PORT}`);
});
