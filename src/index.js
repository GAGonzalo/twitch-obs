const {app,BrowserWindow, ipcMain, Tray} = require('electron');
const url = require('url');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const OBSWebSocket = require('obs-websocket-js');
const obs = new OBSWebSocket();
const optsTwitchApi=require('./files/data.js');
const ComfyJS = require('comfy.js')

require('electron-reload')(__dirname, {
    electron: path.join(__dirname, '../node_modules', '.bin', 'electron')
})


let access_token;
let user_id;

let mainWindow;
let authWindow;
let modifySceneWindow;
let keyWindow;

let scenes;
let authWindowClosable = false;
let exiting = false
let loggedOut=false


let iconPath = path.join(__dirname, 'perf2.jpg')

fs.readFile(path.join(__dirname,'scenes.json'),(err,data)=>{
    if(err) throw err;
    scenes = JSON.parse(data);
});


app.on('ready',()=>{
    
    createMainWindow();
    mainWindow.setMenuBarVisibility(false);

});



app.allowRendererProcessReuse=true
    
// ----------  OBS CONNECT ---------- \\

    obs.connect({
        adress:'localhost:4444'
    }).then(() => {
        console.log('Conectado perfectamente al obs \n');

    obs.sendCallback('GetSceneList',(err,res)=>{
        if(err) throw err;
        else{
            var obslist= res.scenes;

            verifyJsonAndObs(obslist);

            mainWindow.webContents.on('did-finish-load', ()=>{
                mainWindow.webContents.send('scenes:SendList',scenes);
                mainWindow.webContents.send('setTitle');
                obs.sendCallback('GetCurrentScene',(err,res)=>{
                        mainWindow.webContents.send('activeScene',res.name);
                });
            });

        }
    });
}).catch((err)=>{
    app.quit();
    console.log(err);
    });


// ----------  OBS EVENTS ---------- \\

obs.on('SourceCreated',(res)=>{
   
    if(res.sourceKind=='scene'){
        var item = {
            name: res.sourceName,
            twitch_name: 'null'
        };
        scenes.items.push(item);
        saveScenes(scenes);
        mainWindow.webContents.send('newScene',item);
    }
});



obs.on('SourceDestroyed',(data)=>{
    if(!exiting){
        if(data.sourceKind=='scene'){
            for(var i = 0; i< scenes.items.length; i++){
                if (scenes.items[i].name == data.sourceName){
                    scenes.items.splice(i,1);
                    break;
                }
            }
            console.log(scenes.items);
            saveScenes(scenes);
        };
    }
    
});

obs.on('Exiting',()=>{
    app.quit();
    exiting=true;
})


obs.on('SwitchScenes',data=>{
    var escena= scenes.items.filter(e=>{
        return e.name==data.sceneName;
    });
    mainWindow.webContents.send('activeScene',escena[0].name);
    if(escena[0]!= undefined){
        if(escena[0].twitch_name!='null'){
            updateGame(escena[0].twitch_name);
        }
    }
});

obs.on('SourceRenamed',(data)=>{
    for(let item of scenes.items){
        if(item.name == data.previousName){
            item.name = data.newName;
        }
    }
    saveScenes(scenes);
});
    
// ----------  ELECTRON EVENTS ---------- \\




ipcMain.on('ClearStorageData',e=>{
    console.log('Storage Data has been CLEARED, boe se hacia el ingles')
    mainWindow.webContents.session.clearStorageData(()=>{
      
    })
    loggedOut=true;
    createAuthWindow();
    mainWindow.hide();
})

ipcMain.on('receiveLocalStorage',(e,ls)=>{
    if(ls==undefined){
        console.log('No se encontro access token en local storage');
        createAuthWindow();
    }
    else{
      console.log('Se encontro un Access token') 
      access_token=ls;
      localStorageNull = false; 
      mainWindow.show();
    }
});

ipcMain.on('buttonPressed', (e,title)=>{
    updateTitle(title);
    
})

ipcMain.on('modify',(e,name,game)=>{
    newModifySceneWindow();

    ipcMain.on('getData',(e,data)=>{
        modifySceneWindow.webContents.send('setData',name,game);
    });
        
});

ipcMain.on('acceptModify',(e,scene_name,twitch_game)=>{

        obs.sendCallback('GetCurrentScene',(err,res)=>{
            if(res.name == scene_name){
                updateGame(twitch_game);
            }
        });

        for(let item of scenes.items){
            if(item.name==scene_name){
                item.twitch_name=twitch_game;
                saveScenes('Se modifico el juego de la escena << '+scene_name+' >> a "' +twitch_game +'"')
                modifySceneWindow.close();
                modifySceneWindow=null;
                mainWindow.webContents.send('completeModify',scene_name,twitch_game);
                break;
            }
        }
});

ipcMain.on('cardClicked',(e,scene_name,game)=>{
    obs.sendCallback('SetCurrentScene',{"scene-name": scene_name},(res)=>{
        console.log('Se produjo un cambio de escena en OBS, se cambio a la escena: ',scene_name)
    });
});

// ----------  FUNCTIONS ---------- \\

// CREA VENTANA DE AUTORIZACION CON TWITCH


function createAuthWindow(){

    authWindow = new BrowserWindow({
        show:false,
        title:'Twitch Authentification',
        webPreferences:{
            allowRunningInsecureContent:true
        }
  });

    var authUrl ='https://id.twitch.tv/oauth2/authorize?client_id=uiz4nf846olcf0h2xj8kkhvysdsnex&redirect_uri=http://localhost&response_type=token&scope=channel_read+channel_editor';
        authWindow.setMenuBarVisibility(false);
        authWindow.loadURL(authUrl);
        authWindow.show();
        authWindow.webContents.on('will-redirect',(e,url)=>{
            handleCallback(url);
        })
        authWindow.on('close',()=>{
            if(!authWindowClosable){
                app.quit()
            }
            if(loggedOut){
                app.quit()
            }
        });
}

// CREA VENTANA PRINCIPAL DEL PROGRAMA
function createMainWindow(){

    mainWindow=new BrowserWindow({
        webPreferences:{
            nodeIntegration: true
        },
        width: 1024,
        height:960,
        resizable:true,
        show:false
    });

    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname,'views/index.html'),
        protocol:'file',
        slashes:true
    }));

    

    mainWindow.on('minimize',()=>{
        let tray = new Tray(iconPath);
        tray.on('click',()=>{
            mainWindow.show();
            tray=null;
         })
        mainWindow.hide();
    })

    mainWindow.on('show',()=>{
        getTitle().then(data =>{
            user_id=data._id;
            mainWindow.webContents.send('setTitle',data.status);
            console.log(data);
            
            ComfyJS.Init(data.name);
            console.log(data.name);
            
            ComfyJS.onCommand= (user,command,msg,flags,extra)=>{
                console.log(user)
                console.log(command)
                console.log(msg)
                console.log(flags)
                console.log(extra)

                if(command == 'notify' && (flags.broadcaster || flags.mod)){
                    getPhoto(extra.userId).then(data2=>{
                        var logo = data2.logo;
                        mainWindow.webContents.send('newNotif',user,msg,logo)
                    })
                }
            }
        })
    })


}

// CREA VENTANA DE MODIFICACION DE ESCENA
function newModifySceneWindow(){
    modifySceneWindow = new BrowserWindow({
        webPreferences:{
            nodeIntegration:true
        },
        width: 400,
        height: 300,
        title: 'Modify Scene',
        parent: mainWindow,
        modal:true
    });

   modifySceneWindow.setMenuBarVisibility(false);
   modifySceneWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'views/modify-scene.html'),
        protocol: 'file',
        slashes:true
    }));
    modifySceneWindow.on('close',()=>{
        modifySceneWindow=null;
    })
}


// MANEJA LOS CALLBACK DE LOS REDIRECT DEL AUTHWINDOW
function handleCallback(url) {
    var params = new URLSearchParams(url);
    var t,u,f;
    var typeurl=url.substring(18,30);
    var at = params.get('http://localhost/#access_token');
    if(typeurl=='access_token'){
        access_token=at;
        getTitle().then(data =>{
            t = data.status;
            u = data.display_name
            f = data.logo
        }).then(()=>{
            if(!loggedOut){
                authWindowClosable=true;
            }
            else{authWindowClosable = false;}
            authWindow.close();
            mainWindow.webContents.send('setItemLocalStorage',access_token,t,u,f);
            authWindow=null;
            mainWindow.show();
        })
        
        
        
    } 
}

//VERIFICACION DE SCENES.JSON || OBS
function verifyJsonAndObs(obslist){

    var accert =false;
    var need_write=false;
    
    var x = [];
    //VERIFICA QUE EL JSON NO TENGA ESCENAS EXTRAS
    for(var i=0; i<scenes.items.length;i++){
        accert=false;
        for(var j=0; j<obslist.length;j++){
            if(scenes.items[i].name == obslist[j].name){
                accert=true
                break;
            }
        }
        if(!accert){
            console.log('Se encontro la siguiente escena extra en el json: "'+scenes.items[i].name+'" y va a ser removida');
            x.unshift(i); //los agrega al inicio del array
            need_write=true;
        }
    }

    for(var i =0 ; i< x.length ; i++){
        scenes.items.splice(x[i],1);
    }

    
    // VERIFICA QUE EL JSON TENGA TODAS LAS ESCENAS
    obslist.forEach(item=>{
        accert = false;
        scenes.items.forEach(scene=>{
            if(item.name==scene.name){
                accert=true;
            }
        });
        if(!accert){
            console.log("Se escribe en scenes.json la escena: ",item.name);
            need_write=true;
            scenes.items.push({
                name:item.name,
                twitch_name: 'null'
            });
        }
    });

    if(need_write){
        saveScenes('Se actualizo el Json respecto al OBS');
    }

}

// GUARDA EN EL SCENES.JSON LAS ESCENAS DEL OBS CON RESPECTIVOS JUEGOS
function saveScenes(log){
    var json = JSON.stringify(scenes);
    
    fs.writeFile('src/scenes.json',json,'utf8',()=>{
        console.log(log);
    });
}

// ----------  API DE TWITCH ---------- \\


async function getTitle(){

    var response = await fetch("https://api.twitch.tv/kraken/channel", {
        headers: {
        'Accept': "application/vnd.twitchtv.v5+json",
        'Authorization': "OAuth "+access_token,
        "Client-Id": "uiz4nf846olcf0h2xj8kkhvysdsnex",
        'Content-Type': 'application/json',
        } 
    })
    var json = await response.json();
    return json;
    

}

async function getPhoto(userId){
    var response = await fetch("https://api.twitch.tv/kraken/channels/"+userId, {
        headers: {
        'Accept': "application/vnd.twitchtv.v5+json",
        //'Authorization': "OAuth "+access_token,
        "Client-Id": "uiz4nf846olcf0h2xj8kkhvysdsnex",
        'Content-Type': 'application/json',
        } 
    })
    var json = await response.json()
    return json;
}

function updateGame(new_game){

        var body = {
            channel:{
                "game": new_game
            }
        };

        fetch('https://api.twitch.tv/v5/channels/'+user_id,{
            method: 'put',
            body: JSON.stringify(body),
            headers:{
                'Accept': 'application/vnd.twitchtv.v5+json',
                'Authorization': 'OAuth ' +access_token,
                'Content-Type': 'application/json',
                'Client-ID':optsTwitchApi.data.clientID
            }
        }).then(res=>res.json()).then(json=>console.log('Twitch game changed to: '+json.game));
} 


function updateTitle(title){

    

        var body = {
            channel:{
                "status": title
            }
        };

        fetch('https://api.twitch.tv/v5/channels/'+user_id,{
            method: 'put',
            body: JSON.stringify(body),
            headers:{
                'Accept': 'application/vnd.twitchtv.v5+json',
                'Authorization': 'OAuth ' +access_token,
                'Content-Type': 'application/json',
                'Client-ID':optsTwitchApi.data.clientID
            }
        }).then(res=>res.json()).then(json=>console.log('Twitch title changed to: '+title));
}
    



// COMENTARIOS ABSURDOS (QUE, PROBABLEMENTE ALGUN DIA ME SIRVIERON?) :

/*

https://api.twitch.tv/kraken/users/90641546?client_id=uiz4nf846olcf0h2xj8kkhvysdsnex
client id : uiz4nf846olcf0h2xj8kkhvysdsnex
user id (idante32): 90641546
application/vnd.twitchtv.v5+json header accept
https://id.twitch.tv/oauth2/authorize?client_id=uiz4nf846olcf0h2xj8kkhvysdsnex&redirect_uri=http://localhost&response_type=token&scope=channel_editor
oauth token g8yk0lg67081bykp6deva006jqo1yb type bearer

*/