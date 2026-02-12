const Datastore = require('@seald-io/nedb');
const path = require('path');

async function test() {
    // Adjust path to your actual DB location
    const dbPath = path.resolve('C:/Users/kochi/OneDrive/MaplatEditor/nedb.db');
    console.log("Opening DB:", dbPath);
    const db = new Datastore({ filename: dbPath, autoload: true });

    const pageSize = 20;

    console.log("--- Test Page 1 ---");
    const page1 = await new Promise((resolve, reject) => {
        db.find({}).sort({ _id: 1 }).skip(0).limit(pageSize).exec((err, docs) => {
            if (err) reject(err);
            else resolve(docs);
        });
    });
    console.log("Page 1 count:", page1.length);
    if (page1.length > 0) {
        console.log("Page 1 first ID:", page1[0]._id);
        console.log("Page 1 last ID:", page1[page1.length-1]._id);
    }

    console.log("\n--- Test Page 2 (Skip 20) ---");
    const skip = 20;
    const page2 = await new Promise((resolve, reject) => {
        db.find({}).sort({ _id: 1 }).skip(skip).limit(pageSize).exec((err, docs) => {
            if (err) reject(err);
            else resolve(docs);
        });
    });
    console.log("Page 2 count:", page2.length);
    if (page2.length > 0) {
        console.log("Page 2 first ID:", page2[0]._id);
        console.log("Page 2 last ID:", page2[page2.length-1]._id);
        
        if (page1.length > 0 && page1[0]._id === page2[0]._id) {
            console.error("FAIL: Page 2 First ID matches Page 1 First ID! Pagination is NOT working.");
        } else {
            console.log("SUCCESS: Page 2 First ID is different.");
        }
    }

    console.log("\n--- Counting Total ---");
    const count = await new Promise((resolve, reject) => {
        db.count({}, (err, c) => {
            if (err) reject(err);
            else resolve(c);
        });
    });
    console.log("Total DB count:", count);
}

test().catch(console.error);
