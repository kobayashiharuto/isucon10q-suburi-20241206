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
  const limitOffset = " ORDER BY popularity DESC, id ASC LIMIT ? OFFSET ?";
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

app.get("/api/estate/search", async (req, res, next) => {
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
  const coordinates = req.body.coordinates;
  // coordinatesは [{ latitude: number, longitude: number }, ...] の想定

  // 経度(longitude)と緯度(latitude)を配列へ
  const longitudes = coordinates.map((c) => c.longitude);
  const latitudes = coordinates.map((c) => c.latitude);

  // バウンディングボックスの算出（最小値・最大値から）
  const boundingBox = {
    topleft: {
      longitude: Math.min(...longitudes),
      latitude: Math.min(...latitudes),
    },
    bottomright: {
      longitude: Math.max(...longitudes),
      latitude: Math.max(...latitudes),
    },
  };

  // Polygon WKT形式の作成 
  // WKTは "POLYGON((lon1 lat1, lon2 lat2, ...))" のように経度→緯度の順で記述します。
  const polygonCoords = coordinates
    .map((coord) => `${coord.longitude} ${coord.latitude}`)
    .join(",");

  const polygonWKT = `POLYGON((${polygonCoords}))`;

  const getConnection = promisify(db.getConnection.bind(db));
  const connection = await getConnection();
  const query = promisify(connection.query.bind(connection));

  try {
    // 1. バウンディングボックス内の物件を取得
    //   latitude/longitudeの条件順序に注意: 
    //   ここではlatitudeについては top-left <-> bottomright で上下が変わる可能性があるため、
    //   バウンディングボックス決定時にメタ情報（top/bottomなど）が正しいか確認。
    //   通常 "top" は緯度が大きい値、"bottom" は緯度が小さい値となるはず。
    //   もし地図が北を上としている場合、北ほど緯度が大きいため、
    //   latitudeの条件は bottom <= latitude <= top になるように変更すべき。
    //   ここでは初期コードに合わせるが、正確には再検討を要す。
    const estatesInBox = await query(
      `SELECT * FROM estate
       WHERE latitude <= ?
         AND latitude >= ?
         AND longitude <= ?
         AND longitude >= ?
       ORDER BY popularity DESC, id ASC`,
      [
        boundingBox.bottomright.latitude,
        boundingBox.topleft.latitude,
        boundingBox.bottomright.longitude,
        boundingBox.topleft.longitude,
      ]
    );

    // 2. ポリゴン内のデータに絞り込む
    //   ポイントごとにST_Containsを回していたのをまとめて実行する。
    //   ST_GeomFromText('POINT(lon lat)') の形で検索し、まとめてフィルタ可能。
    //   estateテーブルに (longitude, latitude) から成る空間インデックスを用意できれば尚良い。
    //   ここではIN句を使ってまとめて検索する例を示すが、1000件以上になるとINは不利になる可能性あり。
    //   WHERE句で ST_Contains(ST_PolygonFromText(?), ST_PointFromText(?)) を使う場合、
    //   全てを一度でフィルタするには少々トリッキーなため、Estateテーブルに直接Geomカラムを持たせるなどの改善が必要。
    //   ひとまず、ここでは一つのSQLでフィルタする方法として、estateごとにST_Containsを適用するか、または
    //   estateテーブルに POINT(longitude latitude) をST_GeomFromText()で生成し、サブクエリでまとめるなどの方法を検討する。

    // 一案としては、MySQL/MariaDBの場合、次のようなクエリでまとめられる (MariaDB 10.1以降でGIS対応が進んでいる想定):
    // ただし、DB実装により使えるGIS関数が変わるので適宜修正。
    // 下記はサンプルで、ST_PointFromText(…) をFROM句に噛ませるための工夫が必要な場合がある。

    // ここでは簡易的な実装例として、mapでIN句をつくり、全件一括でpolygon判定できるようなビューやJOINを想定するのは難しいため、
    // 次善策：1度のSQLで polygon 内にあるestateを直接取得するようなクエリを書いてみる:
    // 注意: ST_Contains(ST_PolygonFromText(?), ST_PointFromText(CONCAT('POINT(', longitude, ' ', latitude, ')'))) のような動的生成。

    const estatesInPolygon = await query(
      `SELECT * FROM estate 
       WHERE id IN (?) 
         AND ST_Contains(
               ST_PolygonFromText(?),
               ST_GeomFromText(CONCAT('POINT(', longitude, ' ', latitude, ')'))
             )`,
      [estatesInBox.map(e => e.id), polygonWKT]
    );

    // 3. 結果整形
    const results = {
      estates: estatesInPolygon.slice(0, NAZOTTE_LIMIT).map(camelcaseKeys),
      count: Math.min(estatesInPolygon.length, NAZOTTE_LIMIT),
    };

    res.json(results);
  } catch (e) {
    console.error(e);
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
    cache.del("low_priced_chair");

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
    cache.del("low_priced_estate");

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
