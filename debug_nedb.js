const Datastore = require('@seald-io/nedb');
const path = require('path');

async function test() {
    const dbPath = path.resolve('C:/Users/kochi/OneDrive/MaplatEditor/nedb.db');
    console.log("Opening DB:", dbPath);
    const db = new Datastore({ filename: dbPath, autoload: true });

    const pageSize = 20;

    // Test Page 1
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

    // Test Page 11 (Skip 200)
    const skip = 200;
    const page11 = await new Promise((resolve, reject) => {
        db.find({}).sort({ _id: 1 }).skip(skip).limit(pageSize).exec((err, docs) => {
            if (err) reject(err);
            else resolve(docs);
        });
    });
    console.log("Page 11 count:", page11.length);
    if (page11.length > 0) {
        console.log("Page 11 first ID:", page11[0]._id);
    } else {
        console.log("Page 11 is empty as expected if count < 200");
    }

    // Check total count
    const count = await new Promise((resolve, reject) => {
        db.count({}, (err, c) => {
            if (err) reject(err);
            else resolve(c);
        });
    });
    console.log("Total DB count:", count);
}

test().catch(console.error);
