import express, { json } from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import joi from 'joi';
import dayjs from 'dayjs';
import { stripHtml } from "string-strip-html";

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

    let cleansedParticipant = {
        name: ""
    };

    if(typeof(req.body.name) === 'string'){
        cleansedParticipant = {
            name: stripHtml(req.body.name).result
        }
    }
    
    const requestScheme = joi.object(
        {
            name: joi.string().trim().required()
        }
    );
    

    const { error } = requestScheme.validate(req.body);
    const { name } = cleansedParticipant;

    if(error){
        return res.status(422).send(error.details.map(detail => detail.message));
       };

    try{
        const checkName = await db.collection('participants').findOne({name: name});

       if(checkName){
        return res.status(409).send("Já existe um usuário conectado com este nome!");
       };

        await db.collection('participants').insertOne({name: name, lastStatus: Date.now()});

        await db.collection('messages').insertOne(
            {
                from: 'System', 
                to: 'Todos', 
                text: `${name} entra na sala...`, 
                type: 'status', 
                time: momento
            }
        );
        res.sendStatus(201);
    }catch(e){
        res.status(422).send({errorMessage: `Não foi possível registrar o usuário! Causa: ${e}`});
    }
});

app.get("/participants", async (_,res) => {
    try{
        const participants = await db.collection("participants").find({}).toArray();
        res.send(participants);
    }catch(e){
        res.status(422).send({errorMessage: `Não foi possível atualizar a lista de participantes!
        Causa: ${e}`});
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

    const { error } = messageScheme.validate(req.body, {abortEarly: false});
    
    if(error){
        return res.status(422).send(error.details.map(detail => detail.message));
    }
    try{
        const checkName = await db.collection('participants').findOne({name: user});
       
        if(!checkName){
            return res.status(422).send("Usuário não está logado!");
        }

        await db.collection("messages").insertOne({
                from: (stripHtml(user).result).trim(),
                to: (stripHtml(req.body.to).result).trim(),
                text: (stripHtml(req.body.text).result).trim(),
                type: (stripHtml(req.body.type).result).trim(),
                time: momento
        });
        res.sendStatus(201);
    }catch(e){
        res.status(422).send({errorMessage: `Não foi possível postar a mensagem! Causa: ${e}`});
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
        res.status(422).send({errorMessage: `Não foi possível atualizar a lista de mensagens!
        Causa: ${e}`});
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
        res.status(422).send({errorMessage: `Não foi possível atualizar o status do usuário!
        Causa: ${e}`});
    }
});

app.delete('/messages/:ID_DA_MENSAGEM', async (req,res) => {
    const { user } = req.headers;
    const { ID_DA_MENSAGEM } = req.params;
    
    try {
        const message = await db.collection('messages').findOne({_id: new ObjectId(ID_DA_MENSAGEM)});
        
        if(!message){
            return res.sendStatus(404);
        }
        if(message.from !== user){
           return res.sendStatus(401);
        }

        await db.collection('messages').deleteOne({_id: new ObjectId(ID_DA_MENSAGEM)});
        res.sendStatus(200);
    } catch(e){
        res.status(500).send({errorMessage: `Não foi possível deletar a mensagem! Causa: ${e}`});
    }
});

app.put('/messages/:ID_DA_MENSAGEM', async (req, res) => {
    const { user } = req.headers;
    const { ID_DA_MENSAGEM } = req.params;
    const momento = dayjs(Date.now()).format('HH:mm:ss');

    const messageScheme = joi.object(
        {
            to: joi.string().trim().required(),
            text: joi.string().trim().required(),
            type: joi.string().trim().required()
        }
    )

    const { error } = messageScheme.validate(req.body);

    if(error){
        res.status(422).send(error.details.map(detail => detail.message));
    }

    try {
        const message = await db.collection('messages').findOne({_id: new ObjectId(ID_DA_MENSAGEM)});
        
        if(!message){
            return res.sendStatus(404);
        }
        if(message.from !== user){
           return res.sendStatus(401);
        }

        await db.collection('messages').updateOne({_id: new ObjectId(ID_DA_MENSAGEM)},
        {$set: 
            {
                to: req.body.to,
                from: user,
                text: stripHtml(req.body.text).result,
                type: req.body.type,
                time: momento
            }
        });
        res.status(201).send("Mensagem atualizada com sucesso!")
    }catch (e){
        res.status(422).send({errorMessage: `Não foi possível atualizar a mensagem! Causa: ${e}`});
    }
});

const REMOVE_INTERVAL = 15000;
setInterval(async () =>{
    const momento = dayjs(Date.now()).format('HH:mm:ss');
    const seconds = Date.now() - 10000
    try {
        const removedUsers = await db.collection("participants").find({lastStatus: {$lte: seconds}}).toArray();

        if(removedUsers.length !== 0){
            const removedAlert = removedUsers.map(e => {
                return{ 
                    from: `System`,
                    to: 'Todos', 
                    text: `${e.name} sai da sala...`, 
                    type: 'status', 
                    time: momento
                }
           })
           await db.collection("messages").insertMany(removedAlert);
           await db.collection("participants").deleteMany({lastStatus: {$lte: seconds}});
        }
    }catch(e){
        console.log("Erro ao remover inativos!: ",e);
    };
},REMOVE_INTERVAL);

app.listen(process.env.PORT)