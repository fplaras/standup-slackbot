/**
 * Standup Slack Bot
 * Author: fplaras
 * Last Updated: 5/9/2018
 */

/**
 * Required node modules
 */
var Botkit = require('botkit');
var request = require('request');
var moment = require('moment');
var moment = require('moment-timezone');

/**
 * API URLS
 */
var apiUrl = process.env.api;

 //Define Controller
var controller = Botkit.slackbot({
    debug: false,
    interactive_replies: false
  }).configureSlackApp(
    {
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      scopes: ['bot','incoming-webhook'],
    }
  );

var bot = controller.spawn({
    token: process.env.SLACK_BOT
}).startRTM();

/**
 * Slack API Methods
 */

var users = bot.api.users.list({
    token: bot.token
}, function (err, response) {
    users = response.members;
});

var privateChannels = bot.api.groups.list({
    token: bot.token
}, function (err, response) {
    privateChannels = response.groups;
});

var publicChannels = bot.api.channels.list({
    token: bot.token
}, function (err, response) {
    publicChannels = response.channels;
});

/**
 * User Array
 */
var standupUserDetails = [];
var pendingStandupUserDetails = [];
var endOfStandupMinutes = 15;
var botPocChannelName = process.env.testchannel;

/**
 * Timers
 */

var StandupExpirationChecker = setInterval(function () {
    //console.log("StandupExpirationChecker");
    //Mark expired those users who have passed the expiration threshold
    standupUserDetails.forEach(function(element){
   
        if(moment().tz("America/New_York").isSameOrAfter(moment(element.ExpireTime)) && element.StandupExpired == false){
          
            element.StandupExpired = true;
            var standupToSave = [];
            //Report to user
            reportToUsers(element);
            //Report to channel
            reportToStandupChannel(element);
            //Save to database
            standupToSave.push(element);
            saveToDb(standupToSave);
        }
    });
}, 15000);

var StandupReportChecker = setInterval(function () {
    //console.log("StandupReportChecker");
    //Report to user and channel those who have expired standups
    standupUserDetails.forEach(function(element, index, object){
       
        if(element.StandupExpired){
           
            var standupCompleted = element;
            
            //Remove from list
            object.splice(index,1);
            
           
            //Start queued standup for user
            startQueuedStandup(standupCompleted.SlackUserId);
        }
    })

},30000);

/**
 * Bot Controllers
 */

controller.hears(['((^|, )(^start |^Start))'], 'direct_message', function (bot, message) {

    //get list of authorized user standups to start
    var options = {
        method: 'get',
        json: true,
        url: apiUrl + process.env.ApiRootGetStandups,
        qs:{slackUserId: message.user}
    }

    request(options, function (err, res, body) {
      
       
        if (err) {
            reportErrorToChannel(err);
        } else {
            if(res.statusCode != 200){
                reportErrorToChannel(body.message);
            }else{
                var standupChoices = [];
                body.forEach(function(element){
                    var choice = {
                        text: element.StandupName,
                        value: element.StandupId
                    }
                    standupChoices.push(choice);
                });
                bot.reply(message, {
                    "attachments": [
                        {
                            "text": "Choose a standup to start",
                            "fallback": "Uh oh...",
                            "color": "#3AA3E3",
                            "attachment_type": "default",
                            "callback_id": "standup_selection",
                            "actions": [
                                {
                                    "name": "standup_list",
                                    "text": "Pick a standup...",
                                    "type": "select",
                                    "options": standupChoices
                                }
                            ]
                        }
                    ]
                });
            }
           
        }
    });
});


controller.hears(['((^|, )(^edit |^Edit))'], 'direct_message', function (bot, message) {

       
     
                var answerChoices = [];
                standupUserDetails.forEach(function(element, index, object){
                    
                    if(element.SlackUserId == message.user){
                        element.QuestionAnswerList.forEach(function(question, answerIndex, questionObject){
                            var choice = {
                              
                                text: question.Answer,
                                value: index + "|" + element.DmChannelId + "|" + element.SlackUserId + "|" + answerIndex
                            }
                            answerChoices.push(choice);
                        });
                       
                    }
                });

                bot.reply(message, {
                    "attachments": [
                        {
                            "text": "Choose a an entry to edit",
                            "fallback": "Uh oh...",
                            "color": "#3AA3E3",
                            "attachment_type": "default",
                            "callback_id": "edit_selection",
                            "actions": [
                                {
                                    "name": "question_answer_list",
                                    "text": "Pick an entry...",
                                    "type": "select",
                                    "options": answerChoices
                                }
                            ]
                        }
                    ]
                });
});

controller.hears(['((^|, )(^y |^Y |^yesterday |^Yesterday))'], ['direct_message'], function (bot, message) {
   
    if (hasActiveStandup(message.user)) {
      
        if (!hasUserSessionExpired(message.user)) {
          
            var indexForUser = getIndexForUser(message.user);
           
            standupUserDetails[indexForUser].QuestionAnswerList.push({
                QuestionText: 'Yesterday',
                Answer: message.text.substring(message.text.indexOf(" "))
            });

            bot.reply(message, ":trophy: Got it! If you need help to continue, type `help`");
        } else {
            bot.reply(message, ":no_entry: Your standup session has expired");
        }
    } else {
        bot.reply(message, ":no_entry: You are not shceduled for a standup or session has expired");
    }
});

controller.hears(['((^|, )(^o |^O |^obstacle |^Obstacle))'], ['direct_message'], function (bot, message) {

    if (hasActiveStandup(message.user)) {
      
        if (!hasUserSessionExpired(message.user)) {
          
            var indexForUser = getIndexForUser(message.user);

            standupUserDetails[indexForUser].QuestionAnswerList.push({
                QuestionText: 'Obstacle',
                Answer: message.text.substring(message.text.indexOf(" "))
            });
           
            bot.reply(message, ":red-light-blinker: Got it! If you need help to continue, type `help`");
        } else {
            bot.reply(message, ":no_entry: You standup session has expired");
        }


    } else {
        bot.reply(message, ":no_entry: You are not scheduled for a standup or session has expired");
    }
});

controller.hears(['((^|, )(^t |^T |^today |^Today))'], ['direct_message'], function (bot, message) {

    if (hasActiveStandup(message.user)) {
      
        if (!hasUserSessionExpired(message.user)) {
          
            var indexForUser = getIndexForUser(message.user);

            standupUserDetails[indexForUser].QuestionAnswerList.push({
                QuestionText: 'Today',
                Answer: message.text.substring(message.text.indexOf(" "))
            });
            bot.reply(message, ":date: Got it! If you need help to continue, type `help`");
        } else {
            bot.reply(message, ":no_entry: You standup session has expired");
        }


    } else {
        bot.reply(message, ":no_entry: You are not shceduled for a standup or session has expired");
    }
});


controller.hears(['((^|, )(^help |^Help))'], ['direct_message'], function (bot, message) {

    if (hasActiveStandup(message.user)) {
      
        if (!hasUserSessionExpired(message.user)) {
          
            
            var reply_with_attachement = [
                {
                    "color": "#77BED1",
                    "mrkdwn_in": ["text", "pretext","fields"],
                    "pretext": "",
                    "title": "Instructions",
                    "text": "",
                    "fields": [
                        {
                            "title": ":trophy: Add something you accomplished yesterday",
                            "value": ">>>Type `y` or yesterday` before each entry to save an accomplishment \n *Example*: `yesterday One thing i did`",
                            "short": false
                        },
                        {
                            "title": ":calendar: Add something you plan to accomplish today",
                            "value": ">>>Type `t` or today` before each entry to save what you plan on doing \n *Example*: `today One thing i plan on doing`",
                            "short": false
                        },
                        {
                            "title": ":red-light-blinker: Add an obstacle that is preventing you from completing your task",
                            "value": ">>>Type `o` or `obstacle` before each entry to save an obstacle to your task \n *Example*: `obstacle One of the obstacles` \n If you have *no* obstacles dont add anything",
                            "short": false
                        },
                        {
                            "title": "To edit an entry type `edit` select the entry to edit and update the text",
                            "value": "",
                            "short": false
                        }
                    ]
                }];

                postMessageWithAttachement(message.channel,null, reply_with_attachement)
        } else {
            bot.reply(message, "Your standup session has expired");
        }
    } else {
        bot.reply(message, ":no_entry: You are not shceduled for a standup or session has expired");
    }
});

/**
 * WEBSERVER TO HANDLE BUTTON RESPONSES FROM SLACK
 */
controller.setupWebserver(process.env.PORT,function(err,webserver) {

    controller.createWebhookEndpoints(controller.webserver);

    controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
        if (err) {
          res.status(500).send('ERROR: ' + err);
        } else {
          res.send('Success!');
        }
      });

    //handle gets
    webserver.get('/',function(req,res) {
        console.log('get');
    });

    //handle post
    webserver.post('/',function(req,res) {
        console.log('post');
        var requestPayload = JSON.parse(req.body.payload);
        switch (requestPayload.callback_id){

            case 'standup_selection':{
                res.send('Standup started.');
                var options = {
                    method: 'get',
                    json: true,
                    url: apiUrl + process.env.ApiRootGetStandupUsers,
                    qs:{standupId: requestPayload.actions[0].selected_options[0].value}
                }

                request(options, function (err, resp, body) {
                    if (err) {
                        reportErrorToChannel(err);
                    } else {
                        if(resp.statusCode != 200){
                            reportErrorToChannel(body.message);
                        }else{
                            body.forEach(function (element) {
                                
                                //for each user open an IM channel
                                bot.api.im.open({
                                    token: bot.token,
                                    user: element.USER_ID,//From the list of users retrieve the ID
                                    return_im: false
                                }, function (err, response) {
                                    if (err) {
                                        reportErrorToChannel(err);
                                    } else {
            
                                        var userDetails = {
                                            StandupId: '',
                                            UserId: '',
                                            StandupExpired: false,
                                            DmChannelId: '',
                                            StandupName:'',
                                            ReportChannel:'',
                                            StartTime:'',
                                            ExpireTime:'',
                                            QuestionAnswerList: []
                                        }
             
                                        userDetails.StandupId = element.STANDUP_ID;
                                        userDetails.SlackUserId = element.USER_ID;
                                        userDetails.StandupName = element.STANDUP_NAME;
                                        userDetails.ReportChannel = element.STANDUP_REPORT_CHANNEL;
                                        userDetails.StandupExpired = false;
                                        userDetails.StartTime = moment().tz("America/New_York").format('MMM DD YYYY hh:mm:ss a');
                                        userDetails.ExpireTime = moment().tz("America/New_York").add(endOfStandupMinutes,'minutes');
                                        userDetails.DmChannelId = response.channel.id;

                                        //check if user has already been added to a standup
                                        if(hasActiveStandup(element.USER_ID)){
                                            if(!inPendingStandupList(userDetails)){
                                                pendingStandupUserDetails.push(userDetails);
                                                postMessageWithAttachement(response.channel.id, ":information_source: The standup for `" + element.STANDUP_NAME + "` has been queued for you! :information_source:")
                                            }
                                        }else{
                                            
                                            standupUserDetails.push(userDetails);
                                            postNewStandupMessageToUser(userDetails);
                                        }
                                    }
                                });

                            }, this);
                        }
                    }
                });
            }
            break;
            case "edit_selection":{
               
                res.send('Retrieving your entries...');
                var editDetails = requestPayload.actions[0].selected_options[0].value.split("|");
                //index|channel|userId|answerIndex
               
                var message = {
                    user: editDetails[2]
                };

                bot.startPrivateConversation(message, function(err, convo) {
                    convo.say("Editing: " + getAnswerForUserByIndex(editDetails[0],editDetails[3]));
                    convo.ask('Enter the text to replace the selection', 
                    function(response, convo) {
                        standupUserDetails[editDetails[0]].QuestionAnswerList[editDetails[3]].Answer = response.text;
                        convo.next();
                    });
                    convo.say("Updated");
                });
            }
            break;
            default:{
               
            }
            break;
        }
    });
});

/**
 * HELPER FUNCTIONS
 */

var getAnswerForUserByIndex = function(userIndex, answerIndex){
    var text = '';
    text = standupUserDetails[userIndex].QuestionAnswerList[answerIndex].Answer;
    return text;
};

var reportChannelUsersInStandup = function(standupId){
    var users = '';
    var reportChannel = '';
   
    standupUserDetails.forEach(function(element){
        if(element.StandupId == standupId){

        if(users == ''){
            users = getUserName(element.SlackUserId);
        }else{
            users += " | " + getUserName(element.SlackUserId);
        }

        if(!reportChannel){
            reportChannel = element.ReportChannel;
           
        }
    }
    });

    pendingStandupUserDetails.forEach(function(element){
        if(element.StandupId == standupId){
        if(users == ''){
            users = getUserName(element.SlackUserId);
        }else{
            users += " | " + getUserName(element.SlackUserId);
        }
    }
    });
   
    postMessageWithAttachement(getPrivateChannelId(reportChannel), "Users in standup: " + users);
};

var hasActiveStandup = function (userId) {
    var hasActiveStandup = false;
    for (var i = 0; i < standupUserDetails.length; i++) {

        if (standupUserDetails[i].SlackUserId == userId) {
            hasActiveStandup = true;
        }
    }
    return hasActiveStandup;
};

var inPendingStandupList = function (userDetails) {
    var inList = false;
    
    pendingStandupUserDetails.forEach(function(element){
        if(element.SlackUserId == userDetails.SlackUserId && element.StandupId == userDetails.StandupId){
            inList = true;
        }
    });
    return inList;
};

var postNewStandupMessageToUser = function (userDetails) {

    var reply_with_attachement = [
        {
            "color": "#77BED1",
            "mrkdwn_in": ["text", "pretext","fields"],
            "pretext": "This standup is for `"+ userDetails.StandupName +"` available for the next `" + endOfStandupMinutes +" minutes` and will end at `"+moment().tz("America/New_York").add(endOfStandupMinutes,'minutes').format('hh:mm:ss a')+ "`",
            "title": "",
            "text": "*For instructions type `help`*"
        }
    ];
    
    postMessageWithAttachement(userDetails.DmChannelId, null, reply_with_attachement)
};

var postMessageWithAttachement = function (channelId, message, messageAttachments) {
    
    bot.api.chat.postMessage({
        token: bot.token,
        channel: channelId,
        as_user: true,
        text: message,
        attachments: messageAttachments
    }, function (err, response) {
        if (err) {
            reportErrorToChannel(err, messageAttachments);
        }
    });
};

var reportToUsers = function (userDetails) {
   
    var answersForUser = getAnswersForUser(userDetails);

    postMessageWithAttachement(userDetails.DmChannelId, 'Responses have been posted for Standup *' + userDetails.StandupName + '*. Below is your summary', answersForUser);  
};

var reportToStandupChannel = function (userDetails) {
   
    var username = getUserName(userDetails.SlackUserId);
   
    var answersForUser = getAnswersForUserForReportChannel(userDetails.SlackUserId);  
    
         var attachement = [
             {
                    "color": "#54D45C",
                    "mrkdwn_in": ["text", "pretext","fields"],
                    "author_name": '<@'+userDetails.SlackUserId+'>',
                    "author_link": "<@"+userDetails.SlackUserId+">",
                    "author_icon": "https://cdn.iconscout.com/public/images/icon/free/png-512/child-parent-free-ngo-avatar-male-person-30c4bd7e29ce3473-512x512.png",
                    "pretext": "*Standup Responses for * `" + userDetails.StandupName + "` started at: `"+ userDetails.StartTime + "`",
                    "title": "",
                    "text": "-------------------------------",
                    "fields": answersForUser
              }
            ];
   
   
    postMessageWithAttachement(getPrivateChannelId(userDetails.ReportChannel), null, attachement); 
};

var reportErrorToChannel = function (message, messageAttachments) {

    if (messageAttachments) {

        bot.api.chat.postMessage({
            token: bot.token,
            channel: getPrivateChannelId(botPocChannelName),
            as_user: true,
            text: "Error: " + message,
            attachments: messageAttachments
        }, function (err, response) {

        });

    } else {

        bot.api.chat.postMessage({
            token: bot.token,
            channel: getPrivateChannelId(botPocChannelName),
            as_user: true,
            text: "Error: " + message
        }, function (err, response) {

        });
    }
};

var getAnswersForUserForReportChannel = function (userId) {

    var yesterdayItems = [];
    var todayItems = [];
    var obstacleItems = [];

    for (var i = 0; i < standupUserDetails.length; i++) {

        if (standupUserDetails[i].SlackUserId == userId) {
            
            
            standupUserDetails[i].QuestionAnswerList.forEach(function (question) {
                switch (question.QuestionText) {
                    case 'Yesterday': {
                        yesterdayItems.push("• " + question.Answer);
                    }
                        break;
                    case 'Today': {
                        todayItems.push("• " + question.Answer);
                    }
                        break;
                    case 'Obstacle': {
                        if(question.Answer != ''){
                        obstacleItems.push("• " + question.Answer);
                        }
                    }
                        break;
                    default:
                        break;
                }
            });

            var answers;

            if(obstacleItems.length > 0){
                answers = [
                    {
                        "title": ":trophy: Yesterday Items",
                        "value": "",
                        "short": false
                    },
                    {
                        "title": ":date: Today Items",
                        "value": "",
                        "short": false
                    },
                    {
                        "title": ":red-light-blinker: Obstacle Items",
                        "value": "",
                        "short": false
                    } 
                ];
            }else{
                answers = [
                    {
                        "title": ":trophy: Yesterday Items",
                        "value": "",
                        "short": false
                    },
                    {
                        "title": ":date: Today Items",
                        "value": "",
                        "short": false
                    } 
                ];
            }

            yesterdayItems.forEach(function (item) {
                answers[0].value += item + "\n";
            });
            todayItems.forEach(function (item) {
                answers[1].value += item + "\n";
            });
            obstacleItems.forEach(function (item) {
                answers[2].value += item + "\n";
            });
        }
    }
   
    return answers;
};

var getAnswersForUser = function (userDetails) {

    var yesterdayItems = [];
    var todayItems = [];
    var obstacleItems = [];

    userDetails.QuestionAnswerList.forEach(function(question){

        switch (question.QuestionText) {
            case 'Yesterday': {
                yesterdayItems.push("• " + question.Answer);
            }
                break;
            case 'Today': {
                todayItems.push("• " + question.Answer);
            }
                break;
            case 'Obstacle': {
                if(question.Answer != ''){
                obstacleItems.push("• " + question.Answer);
                }
            }
                break;
            default:
                break;
        }
    });    

    var answers;

            if(obstacleItems.length > 0){
                answers = [{
                    "color": "#D4D454",
                    "title": ":trophy: Yesterday Items",
                    "pretext": "",
                    "text": "",
                    "mrkdwn_in": ["text", "pretext"]
                }, {
                    "color": "#5484D4",
                    "title": ":date: Today Items",
                    "pretext": "",
                    "text": "",
                    "mrkdwn_in": ["text", "pretext"]
                }, {
                    "color": "#D45454",
                    "title": ":red-light-blinker: Obstacle Items",
                    "pretext": "",
                    "text": "",
                    "mrkdwn_in": ["text", "pretext"]
                }];
            }else{
                answers = [{
                    "color": "#D4D454",
                    "title": ":trophy: Yesterday Items",
                    "pretext": "",
                    "text": "",
                    "mrkdwn_in": ["text", "pretext"]
                }, {
                    "color": "#5484D4",
                    "title": ":date: Today Items",
                    "pretext": "",
                    "text": "",
                    "mrkdwn_in": ["text", "pretext"]
                }];
            }

    yesterdayItems.forEach(function (item) {
        answers[0].text += item + "\n";
    });
    todayItems.forEach(function (item) {
        answers[1].text += item + "\n";
    });
    obstacleItems.forEach(function (item) {
        answers[2].text += item + "\n";
    });

    return answers;
};

var startQueuedStandup = function (slackUser) {
   
    //check if user has pending standup
    pendingStandupUserDetails.forEach(function(element, index, object){
       
        if(element.SlackUserId == slackUser){
            
            //has pending standup
            //Check that user is not in an active standup
            if(!hasActiveStandup(slackUser)){
               
                element.ExpireTime = moment().tz("America/New_York").add(endOfStandupMinutes,'minutes');
                //add to active standup list
                standupUserDetails.push(element);

                //post standup to user
                postNewStandupMessageToUser(element);

                //remove this element from pending
                object.splice(index, 1);

            }
        }
    }); 
};

var getUserName = function (userId) {
    var username = '';
    for (var i = 0; i < users.length; i++) {
        if (users[i].id == userId) {
            username = users[i].name;
            return username;
        }
    }
    return username;
};

var getPrivateChannelId = function (channelName) {
    //standup_results
    var channelId = '';
    for (var i = 0; i < privateChannels.length; i++) {
        if (privateChannels[i].name == channelName) {
            channelId = privateChannels[i].id;
            return channelId;
        }
    }
    return channelId;
};

var getPublicChannelId = function (channelName) {
    //standup_results
    var channelId = '';
    for (var i = 0; i < publicChannels.length; i++) {
        if (publicChannels[i].name == channelName) {
            channelId = publicChannels[i].id;
            return channelId;
        }
    }
    return channelId;
};

var saveToDb = function (standupToSave) {
    postData(standupToSave, 'Standup');
};

var getIndexForUser = function (userId) {
    var userIndex = -1;
    standupUserDetails.forEach(function(element, index, object){
        
        if(element.SlackUserId == userId){
            userIndex = index;
            return userIndex;
        }
    });
    return userIndex;
};

var hasUserSessionExpired = function (userId) {
    var sessionExpired = true;
    standupUserDetails.forEach(function(element, index, object){
        if(element.SlackUserId == userId && !element.StandupExpired){
            sessionExpired = false;
        }
    });
    return sessionExpired;
};

/**
 * POST / GET Methods
 */
var postData = function (jsonObj, apiName) {

    var options = {
        method: 'post',
        body: jsonObj,
        json: true,
        url: apiUrl + apiName
    }

    request(options, function (err, res) {

        if (err) {
            reportErrorToChannel(err);
        } else {
            return (res);
        }
    });
};

var getData = function (jsonObj, apiName) {

    var options = {
        method: 'get',
        data: jsonObj,
        json: true,
        url: apiUrl + apiName
    }

    request(options, function (err, res, body) {

        if (err) {
            reportErrorToChannel(err);
        } else {
            if (body.Message)
                reportErrorToChannel(body.Message);
            else
                return (body);
        }
    });
};