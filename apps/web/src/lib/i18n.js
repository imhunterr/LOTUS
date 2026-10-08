/** Recall alerts in regional languages (feature D). Extend freely. */
export const LANGS = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ", te: "తెలుగు" };

const T = {
  affectedTitle: {
    en: "A medicine you received has been recalled",
    hi: "आपको दी गई एक दवा वापस मंगाई गई है",
    kn: "ನೀವು ಪಡೆದ ಒಂದು ಔಷಧವನ್ನು ಹಿಂಪಡೆಯಲಾಗಿದೆ",
    te: "మీరు తీసుకున్న ఒక మందును రీకాల్ చేశారు",
  },
  affectedBody: {
    en: "Do not stop any medicine on your own. Contact your doctor or pharmacy today.",
    hi: "अपनी मर्ज़ी से कोई दवा बंद न करें। आज ही अपने डॉक्टर या फ़ार्मेसी से संपर्क करें।",
    kn: "ನೀವಾಗಿಯೇ ಯಾವುದೇ ಔಷಧ ನಿಲ್ಲಿಸಬೇಡಿ. ಇಂದೇ ನಿಮ್ಮ ವೈದ್ಯರು ಅಥವಾ ಫಾರ್ಮಸಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    te: "మీ అంతట మీరు ఏ మందునూ ఆపకండి. ఈరోజే మీ డాక్టర్ లేదా ఫార్మసీని సంప్రదించండి.",
  },
  safeTitle: {
    en: "You're not affected by any recall",
    hi: "आप किसी भी रिकॉल से प्रभावित नहीं हैं",
    kn: "ಯಾವುದೇ ಹಿಂಪಡೆಯುವಿಕೆ ನಿಮ್ಮ ಮೇಲೆ ಪರಿಣಾಮ ಬೀರಿಲ್ಲ",
    te: "ఏ రీకాల్ కూడా మీకు వర్తించదు",
  },
};

export const t = (key, lang = "en") => T[key]?.[lang] ?? T[key]?.en ?? key;
