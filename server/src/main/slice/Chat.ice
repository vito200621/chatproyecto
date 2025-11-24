module Chat {

    sequence<byte> ByteSeq;
    sequence<string> StringSeq;


    struct Message {
        string id;
        string sender;
        string content;
        long timestamp;
        string type;
    };

    struct User {
        string id;
        string username;
        bool online;
    };

    struct Group {
        string id;
        string name;
        StringSeq members;
    };


    exception UserNotFound {
        string reason;
    };

    exception GroupNotFound {
        string reason;
    };


    sequence<Group> GroupSeq;
    sequence<Message> MessageSeq;


    interface ChatCallback {
        void onMessage(Message msg);
        void onVoiceNote(string from, string filename, ByteSeq data);
        void onUserJoined(string user, string group);
    };


    interface ChatService {
        User login(string username);
        void logout(string userId);

        void sendPrivateMessage(string fromUser, string toUser, string message) throws UserNotFound;
        void sendGroupMessage(string fromUser, string groupName, string message) throws GroupNotFound;

        string createGroup(string groupName, string creator);
        void joinGroup(string groupName, string user) throws GroupNotFound;
        void leaveGroup(string groupName, string user) throws GroupNotFound;
        Group getGroupDetails(string groupName) throws GroupNotFound;
        GroupSeq listGroups(string userId);

        void sendVoiceNoteToUser(string fromUser, string toUser, string filename, ByteSeq data) throws UserNotFound;
        void sendVoiceNoteToGroup(string fromUser, string groupName, string filename, ByteSeq data) throws GroupNotFound;

        MessageSeq getMessageHistory(string userId, string targetId, string targetType);

        void registerCallback(string userId, ChatCallback* cb);
        void unregisterCallback(string userId);
    };

    interface AudioCallService {
        void startCall(string fromUser, string toUser) throws UserNotFound;
        void streamCallAudio(string fromUser, ByteSeq audioData);
        void endCall(string fromUser, string toUser);
    };
};