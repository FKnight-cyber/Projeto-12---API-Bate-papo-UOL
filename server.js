import express, { json } from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import joi from 'joi';
import dayjs from 'dayjs'

dotenv.config();

const app = express();
app.use(cors());
app.use(json());

let db = null;
const mongoClient = new MongoClient(process.env.MONGO_URL);
const promise = mongoClient.connect();

promise.then(()=>{
    db = mongoClient.db(process.env.BANCO);
    console.log("banco on")
});

promise.catch(e => console.log("Não foi possível se conectar ao banco de dados", e));

app.post("/participants", async (req,res) => {
    const momento = dayjs(Date.now()).format('HH:mm:ss');
    const requestScheme = joi.object(
        {
            name: joi.string().required()
        }
    );

    const validation = requestScheme.validate(req.body);

    if(validation.error){
        return res.status(422).send(validation.error.details.map(detail => detail.message));
       };

    try{
        const checkName = await db.collection('participants').findOne({name: req.body.name});

       if(checkName){
        return res.status(409).send("Já existe um usuário conectado com este nome!");
       };

        await db.collection('participants').insertOne({name: req.body.name, lastStatus: Date.now()});

        await db.collection('messages').insertOne(
            {
                from: `${req.body.name}`, 
                to: 'Todos', 
                text: 'entra na sala...', 
                type: 'status', 
                time: momento
            }
        );
        res.sendStatus(201);
    }catch(e){
        res.status(422).send("Não foi possível registrar o usuário!");
    }
});

app.get("/participants", async (_,res) => {
    try{
        const participants = await db.collection("participants").find({}).toArray();
        res.send(participants);
    }catch(e){
        res.sendStatus(500);
    }
});

app.post("/messages", async (req,res) => {
    const momento = dayjs(Date.now()).format('HH:mm:ss');
    const { user } = req.headers;

    const messageScheme = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid("message","private_message").required(),
    });

    const validation = messageScheme.validate(req.body, {abortEarly: false});

    if(validation.error){
        return res.status(422).send(validation.error.details.map(detail => detail.message));
    }
    try{
        const checkName = await db.collection('participants').findOne({name: user});
       
        if(!checkName){
            return res.status(422).send("Usuário não está logado!");
        }

        await db.collection("messages").insertOne({
                from: user,
                to: req.body.to,
                text: req.body.text,
                type: req.body.type,
                time: momento
        });
        res.sendStatus(201);
    }catch(e){
        console.log(e)
        res.sendStatus(422);
    }
});

app.get("/messages", async (req,res) => {
    const {limit} = req.query;
    const {user} = req.headers;
    try{
        const dbTo = await db.collection("messages").find({to: user}).toArray();
        const dbFrom = await db.collection("messages").find({from: user}).toArray();
        const dbPublic = await db.collection("messages").find({to: "Todos"}).toArray();
        const myMessages = [...new Set([...dbTo ,...dbFrom ,...dbPublic])];

        if(isNaN(limit)){
            return res.status(201).send(myMessages);
        }

        res.status(201).send(myMessages.splice(-limit));
    }catch(e){
        res.sendStatus(422);
    }
});

app.post("/status", async (req,res) => {
    const { user } = req.headers;
    try {
        const participant = await db.collection("participants").findOne({name: user});
   
        if(!participant){
            return res.sendStatus(404);
        }

        await db.collection("participants").updateOne({name: user},{$set: {lastStatus: Date.now()}});

        res.sendStatus(200);
    }catch(e){
        res.sendStatus(500);
    }
});

const REMOVE_INTERVAL = 1000*15;

setInterval(async () =>{
    const momento = dayjs(Date.now()).format('HH:mm:ss');
    const seconds = Date.now() - (10 * 1000)
    try {
        const removedUsers = await db.collection("participants").find({lastStatus: {$gt: seconds}}).toArray();

        if(removedUsers.length !== 0){
            const removedAlert = removedUsers.map(e => {
                return{ 
                    from: `${e.name}`,
                    to: 'Todos', 
                    text: `sai da sala...`, 
                    type: 'status', 
                    time: momento
                }
           })
           await db.collection("messages").insertMany(removedAlert);
           await db.collection("participants").deleteMany({lastStatus: {$gt: seconds}});
        }
    }catch(e){
        console.log("Não há ninguem para deletar");
    };
},REMOVE_INTERVAL);

app.listen(process.env.PORT)