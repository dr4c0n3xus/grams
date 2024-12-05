import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { createSpinner } from "nanospinner";
import { exit } from "process";
import { exec } from "child_process";
import * as cheerio from "cheerio";

async function getPublic(username) {
  const spinner = createSpinner("fetching profile..").start();
  try {
    const formData = new FormData();

    formData.append("k_exp", "1731058485");
    formData.append(
      "k_token",
      "c678b8bb1288f7b73f2e9c09db231539da1539adeea9602207e563df54860390",
    );
    formData.append("q", `https://www.instagram.com/${username}`);
    formData.append("t", "media");
    formData.append("lang", "en");
    formData.append("v", "v2");

    const res = await fetch("https://v3.saveclip.app/api/ajaxSearch", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    spinner.success({
      text: "profile found",
    });
    return data.data;
  } catch (error) {
    spinner.error({ text: "failed to fetch profile" });
    console.error(error);
    exit(1);
  }
}

async function getUrl(username) {
  try {
    const formData = new FormData();
    formData.append("l", `https://www.instagram.com/${username}`);

    const res = await fetch("https://v3.saveclip.app/api/get-url", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    return data.data;
  } catch (error) {
    console.error(error);
    exit(1);
  }
}

async function getProfile(profileUrl) {
  const spinner = createSpinner("fetching profile..").start();
  try {
    const res = await fetch(profileUrl, {
      headers: {
        Cookie: process.env.COOKIE,
      },
    });
    const data = await res.json();

    if (data?.data?.user?.edge_owner_to_timeline_media?.edges?.length === 0) {
      spinner.error({ text: "failed to fetch profile" });
      exit(1);
    }
    spinner.success({
      text: "profile found",
    });
    return data.data.user.edge_owner_to_timeline_media.edges;
  } catch (error) {
    spinner.error({ text: "failed to fetch profile" });
    console.error(error);
    exit(1);
  }
}

async function extractImages(edges) {
  const images = edges.flatMap((edge) => {
    if (
      edge.node.edge_sidecar_to_children &&
      edge.node.edge_sidecar_to_children.edges.length > 0
    ) {
      return edge.node.edge_sidecar_to_children.edges
        .map((childEdge) => childEdge.node.display_url)
        .filter((url) => url); // Filter out any empty URLs
    } else {
      return edge.node.display_url ? [edge.node.display_url] : []; // Return an array with the URL or an empty array
    }
  });
  if (images.length === 0) {
    console.error("no images found");
    exit(1);
  }
  return images;
}

async function getImages(html) {
  const $ = cheerio.load(html);

  const images = [];
  $("img").each((index, element) => {
    let src = $(element).attr("src");
    let dataSrc = $(element).attr("data-src");

    if (
      (src && !src.endsWith(".gif")) ||
      (dataSrc && !dataSrc.endsWith(".gif"))
    ) {
      if (src && !src.endsWith(".gif")) images.push(src);
      if (dataSrc && !dataSrc.endsWith(".gif") && !src) images.push(dataSrc);
    }
  });

  return images;
}

async function saveImages(images) {
  let count = 0;
  const spinner = createSpinner("saving images...").start();

  const downloadPromises = images.map((url) => {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const imagePath = path.join("data", `image-${timestamp}.jpg`);

      exec(`curl -s -o "${imagePath}" "${url}"`, (error, stdout, stderr) => {
        if (error) {
          console.error(error.message);
          return reject(error);
        }

        if (stderr) {
          console.error(stderr);
        }

        const stats = fs.statSync(imagePath);
        if (stats.size === 0) {
          return reject(new Error(`downloaded file is empty: ${imagePath}`));
        }

        count++;
        spinner.update({
          text: `saved ${count} of ${images.length} images...`,
        });
        resolve();
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
    spinner.success({ text: `${count} images saved to data/` });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

async function getUsername() {
  const answer = await inquirer.prompt([
    {
      type: "input",
      name: "username",
      message: "enter instagram username:",
      validate: (input) => {
        if (input.trim() === "") {
          return "username cannot be empty, enter a valid username.";
        }
        return true;
      },
    },
  ]);
  return answer.username;
}

async function init() {
  const profile = await inquirer.prompt([
    {
      type: "list",
      name: "type",
      message: "Select the type of profile",
      choices: ["public", "private", "exit"],
    },
  ]);

  switch (profile.type) {
    case "public": {
      const username = await getUsername();
      const html = await getPublic(username);
      const images = await getImages(html);
      await saveImages(images);
      break;
    }
    case "private": {
      const username = await getUsername();
      const profileUrl = await getUrl(username);
      const edges = await getProfile(profileUrl);
      const images = await extractImages(edges);
      await saveImages(images);
      break;
    }
    case "exit": {
      console.log("Goodbye!");
      process.exit(0);
    }
  }
}

init();
