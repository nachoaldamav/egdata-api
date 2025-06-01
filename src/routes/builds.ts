import { Hono } from "hono";
import { db } from "../db/index.js";
import { Item } from "@egdata/core.schemas.items";
import { Asset } from "@egdata/core.schemas.assets";
import { type Filter, ObjectId, type Sort } from "mongodb";
import type { AnyObject } from "mongoose";
import { InstallManifest } from "../types/install-manifest.js";

const app = new Hono();

// Interface for the file batch upload request
interface FileBatchUpload {
  uploadId: string;
  files: Array<{
    fileName: string;
    fileHash: string;
    fileSize: number;
    depth: number;
    installTags?: string[];
  }>;
}

// Endpoint to initiate manifest upload
app.post("/upload/init", async (c) => {
  const manifest = await c.req.json<InstallManifest>();

  // First check if the item exists and validate the app name
  const item = await Item.findOne({
    id: manifest.CatalogItemId,
    namespace: manifest.CatalogNamespace,
  });

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  // Check if the app name is valid for this item
  const validAppNames = item.releaseInfo.map((r) => r.appId);
  if (!validAppNames.includes(manifest.AppName)) {
    return c.json(
      {
        error: "Invalid app name for this item",
        validAppNames,
      },
      400
    );
  }

  // Check if build already exists
  const existingBuild = await db.db.collection("builds").findOne({
    appName: manifest.AppName,
    buildId: manifest.AppVersionString,
  });

  if (existingBuild) {
    return c.json({ error: "Build already exists" }, 409);
  }

  // Generate a unique upload ID
  const uploadId = new ObjectId();

  // Create a temporary upload record
  await db.db.collection("upload_sessions").insertOne({
    _id: uploadId,
    itemId: manifest.CatalogItemId,
    appName: manifest.AppName,
    buildId: manifest.AppVersionString,
    manifestHash: manifest.ManifestHash,
    displayName: manifest.DisplayName,
    installSize: manifest.InstallSize,
    launchExecutable: manifest.LaunchExecutable,
    installTags: manifest.InstallTags,
    baseUrls: manifest.BaseURLs,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ uploadId: uploadId.toString() });
});

// Endpoint to upload file batches
app.post("/upload/batch", async (c) => {
  const body = await c.req.json<FileBatchUpload>();

  // Get the upload session
  const session = await db.db.collection("upload_sessions").findOne({
    _id: new ObjectId(body.uploadId),
  });

  if (!session) {
    return c.json({ error: "Upload session not found" }, 404);
  }

  if (session.status !== "pending") {
    return c.json({ error: "Upload session is no longer active" }, 400);
  }

  // Insert the files
  await db.db.collection("files").insertMany(
    body.files.map((file) => ({
      ...file,
      manifestHash: session.buildId,
      uploadId: new ObjectId(body.uploadId),
    }))
  );

  // Update the session
  await db.db.collection("upload_sessions").updateOne(
    { _id: new ObjectId(body.uploadId) },
    {
      $inc: { uploadedFiles: body.files.length },
      $set: { updatedAt: new Date() },
    }
  );

  // Check if all files have been uploaded
  if (session.uploadedFiles + body.files.length >= session.totalFiles) {
    // Create the build record
    await db.db.collection("builds").insertOne({
      appName: session.appName,
      buildId: session.buildId,
      itemId: session.itemId,
      hash: session.buildId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mark the session as completed
    await db.db
      .collection("upload_sessions")
      .updateOne(
        { _id: new ObjectId(body.uploadId) },
        { $set: { status: "completed", updatedAt: new Date() } }
      );
  }

  return c.json({ success: true });
});

// Endpoint to handle install manifest upload
app.post("/upload/install-manifest", async (c) => {
  const manifest = await c.req.json<InstallManifest>();

  // First check if the item exists and validate the app name
  const item = await Item.findOne({
    id: manifest.CatalogItemId,
  });

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  // Check if the app name is valid for this item
  const validAppNames = item.releaseInfo.map((r) => r.appId);
  if (!validAppNames.includes(manifest.AppName)) {
    return c.json(
      {
        error: "Invalid app name for this item",
        validAppNames,
      },
      400
    );
  }

  // Check if build already exists
  const existingBuild = await db.db.collection("builds").findOne({
    appName: manifest.AppName,
    buildId: manifest.AppVersionString,
  });

  if (existingBuild) {
    return c.json({ error: "Build already exists" }, 409);
  }

  // Create the build record
  const build = await db.db.collection("builds").insertOne({
    appName: manifest.AppName,
    buildId: manifest.AppVersionString,
    itemId: manifest.CatalogItemId,
    hash: manifest.ManifestHash,
    displayName: manifest.DisplayName,
    installSize: manifest.InstallSize,
    installLocation: manifest.InstallLocation,
    launchExecutable: manifest.LaunchExecutable,
    installTags: manifest.InstallTags,
    baseUrls: manifest.BaseURLs,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({
    success: true,
    buildId: build.insertedId.toString(),
  });
});

app.get("/:id", async (c) => {
  const { id } = c.req.param();

  const build = await db.db.collection("builds").findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: "Build not found" }, 404);
  }

  const asset = await Asset.findOne({
    artifactId: build.appName,
    platform: build.labelName.split("-")[1],
  });

  return c.json({
    ...build,
    downloadSizeBytes: asset?.downloadSizeBytes,
    installedSizeBytes: asset?.installedSizeBytes,
  });
});

app.get("/:id/files", async (c) => {
  const { id } = c.req.param();
  const limit = Number.parseInt(c.req.query("limit") || "25", 10);
  const page = Number.parseInt(c.req.query("page") || "1", 10);
  const sort = c.req.query("sort") || "depth";
  const direction = c.req.query("dir") || "asc";
  const filename = c.req.query("q");

  // Get the extension(s) query parameter, expecting a comma-separated list if there are multiple
  const extensions = c.req.query("extension")?.split(",");

  const build = await db.db.collection("builds").findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: "Build not found" }, 404);
  }

  // Base query
  const query: Filter<AnyObject> = {
    manifestHash: build.hash,
  };

  const sortQuery: Sort = {};

  if (filename && extensions) {
    // Both filename and extensions are provided
    query.$and = [
      { fileName: { $regex: new RegExp(filename, "i") } },
      {
        fileName: { $regex: new RegExp(`\\.(${extensions.join("|")})$`, "i") },
      },
    ];
  } else if (filename) {
    // Only filename is provided
    query.fileName = { $regex: new RegExp(filename, "i") };
  } else if (extensions) {
    // Only extensions are provided
    query.fileName = {
      $regex: new RegExp(`\\.(${extensions.join("|")})$`, "i"),
    };
  }

  if (sort === "depth") {
    sortQuery.depth = direction === "asc" ? 1 : -1;
    sortQuery.fileName = direction === "asc" ? 1 : -1;
  } else if (sort === "fileName") {
    sortQuery.fileName = direction === "asc" ? 1 : -1;
  } else if (sort === "fileSize") {
    sortQuery.fileSize = direction === "asc" ? 1 : -1;
  }

  const files = await db.db
    .collection("files")
    .find(query)
    .sort(sortQuery)
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  const total = await db.db.collection("files").countDocuments(query);

  return c.json({
    files,
    page,
    limit,
    total,
  });
});

app.get("/:id/items", async (c) => {
  const { id } = c.req.param();
  const limit = Number.parseInt(c.req.query("limit") || "25", 10);
  const page = Number.parseInt(c.req.query("page") || "1", 10);

  const build = await db.db.collection("builds").findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: "Build not found" }, 404);
  }

  const items = await Item.find({
    "releaseInfo.appId": build.appName,
  })
    .skip((page - 1) * limit)
    .limit(limit);

  const total = await Item.countDocuments({
    "releaseInfo.appId": build.appName,
  });

  return c.json({
    data: items,
    page,
    limit,
    total,
  });
});

app.get("/:id/install-options", async (c) => {
  const { id } = c.req.param();

  const build = await db.db.collection("builds").findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: "Build not found" }, 404);
  }

  const filesWithInstallOptions = await db.db
    .collection<{
      manifestHash: string;
      installTags: string[];
      fileHash: string;
      fileSize: number;
    }>("files")
    .find({
      manifestHash: build.hash,
      installTags: {
        $exists: true,
        $not: { $size: 0 },
      },
    })
    .toArray();

  const result: Record<
    string,
    {
      files: number;
      size: number;
    }
  > = {};

  for (const file of filesWithInstallOptions) {
    const installOptions = file.installTags.map((t) => t);

    for (const installOption of installOptions) {
      if (!result[installOption]) {
        result[installOption] = {
          files: 0,
          size: 0,
        };
      }

      result[installOption].files++;
      result[installOption].size += file.fileSize;
    }
  }

  return c.json(result);
});

export default app;
