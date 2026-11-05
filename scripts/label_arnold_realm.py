#!/usr/bin/env python3
"""Apply editable, best-guess labels and tiers to the Realm collection.

Uses the old board's descriptions where an explicit correspondence is known.
Labels are inferred from filenames/board labels, not verified transcriptions.
Run again after downloading; the old collection is read only.
"""
import json
import re
from pathlib import Path
from arnold_sections import organize

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "assets/audio/arnold-realm"
STOP = {"1-st", "1-st-a", "1-st-b", "1-st-c"}

# New filename stem -> old filename stem. Tier follows the old collection.
MATCHES = {
    "beback": "ill-be-back", "imback": "im-back",
    "cop": "im-a-cop-you-idiot", "det": "im-detective-john-kimble",
    "mine": "ive-got-news-for-you-you-are-mine-now-you-belong-to-me",
    "cookies-3": "put-that-cookie-down-now", "cookies-2": "who-told-you-can-eat-my-cookies",
    "sarah-connor": "sarah-connor", "stopwhining": "stop-whining",
    "daddy": "who-is-your-daddy-and-what-does-it-do",
    "getmother": "get-your-mother-please", "talkmother": "let-me-talk-to-your-mother",
    "outofmind": "are-you-out-of-your-mind", "dontdothat": "dont-do-that",
    "storystraight": "get-your-story-straight", "morn": "good-morning",
    "howru": "how-are-you", "ilied": "i-lied", "vac": "i-need-a-vacation",
    "helpneed": "i-need-your-help", "johnconnor": "john-connor",
    "johnkimble": "im-john-kimble", "negative": "negative", "nodeal": "no-deal",
    "2weekpack": "whats-in-the-two-week-package", "whereisshe": "where-is-she",
    "realname": "whats-your-real-name", "whoru": "who-are-you",
    "whynot": "why-not", "whattalk": "what-are-you-talking-about",
}

# Descriptive labels for abbreviated board buttons. These are editable guesses.
LABELS = dict(line.split("|", 1) for line in """
bastard|You bastard!
bitch|Bitch!
bulllllllshit|Bullshit! (drawn out)
bullshit|Bullshit!
choppa|Get to the chopper!
coldblood|You cold-blooded bastard!
crap|Don't give me that crap.
deep|One of us is in deep trouble.
dontbs|Come on, don't bullshit me.
dontknowu|I don't know you.
dontscream|Stop shouting. I'm not deaf.
fu|Fuck you.
fuass|Fuck you, asshole!
fuckbitch|Fucking bitch!
funny|Do you think that's funny?
helldo|What the hell did you do?
hellthink|What the hell were you thinking?
idiot|You idiot!
kissmom|Do you kiss your mother with that mouth?
lackdiscipline|You lack discipline.
leavealone|Leave me alone.
likeothers|You're just like all the others.
mfbitch|Motherfucking bitch!
ohno|Oh, no!
ohshit|Oh, shit!
outofmind|Are you out of your mind?
outr|This is outrageous!
rid|This is ridiculous.
saysamething|You said the same thing.
shutup|Shut up!
shutup-3x|Shut up! (three times)
shutupppp|Shut up! (shouted)
sob|You son of a bitch!
stfu|Shut the fuck up!
stom|Leave enough room for my fist in your stomach.
stopit|Stop it!
stoplaugh|Stop laughing.
stopthat|Stop that.
takeback|Take it back.
ucrazy|Are you crazy?
udid|You did.
ulie|You lie!
ustarted|You started it.
wtf|What the fuck?
wtfwrong|What the fuck did I do wrong?
arrest|This is an arrest.
cake|A piece of cake.
charges|I'm pressing charges against you.
cocaine|Cocaine.
drug|Who are your drug suppliers?
drug-2|Give me the names of your drug suppliers and distributors.
police|Hey, I'm a police officer.
talkcrime|Let's talk about crime.
underarrest|You're under arrest. Put your hands on your head.
1hr|In approximately one hour.
253|Two hours and fifty-three minutes.
618|6:18 p.m.
645|6:45.
1130|11:30.
feb13|February 13th.
feb14|February 14th.
oct7th|October 7th.
rightnow|Right now?
timefor|It's time for…
whenuwant|Whenever you want.
daddy|Who is your daddy and what does he do?
getmother|Get your mother, please.
talkmother|Let me talk to your mother.
speakwife|I need to speak to my wife. Could you get her on the phone?
speakwife-2|Get my wife on the phone.
whereisshe|Where is she?
whereshenow|Where is she now?
wifecrazy|My wife is crazy.
mywife|My wife.
break|What's for breakfast?
cookies|Who told you you could eat my cookies?
cookies-2|Who told you you could eat my cookies?
cookies-3|Put that cookie down! Now!
dinner|What's for dinner?
drinkbake|You should not drink and bake.
hungry|I'm hungry.
lookstom|Look at my stomach.
makefat|It makes you fat.
pasta|Pasta.
sourk|Sauerkraut.
yummy|Yummy!
2weekpack|What's in the two-week package?
onenight|One night.
roomplease|Yes, I would like to have a room, please.
tonight|Tonight.
vac|I need a vacation.
wantroom|I want a room.
findme|How did you find me?
goingon|What's going on?
goingonnow|I want to know what's going on, and I want to know right now.
gottado|What do we have to do?
hellgoingon|What the hell is going on?
hellqtpie|Hello, cutie-pie.
helpmenow|Help me now!
helpneed|I need your help.
helpwant|I want your help.
hihoney|Hi, honey.
howdoinbuddy|How are you doing, buddy?
howdy|Howdy, stranger.
howru|How are you?
imback|I'm back.
knowu|I'd like to get to know you.
lookingforsome|I'm looking for someone.
meetu|Nice to meet you.
morn|Good morning.
realname|What's your real name?
sungdam|Damn sunglasses.
sup|What's up?
supguys|What's up, guys?
surprise|Get ready for a big surprise.
talkimp|I need to talk to you. It's important.
talksome|I'd like to talk to somebody.
wakeup|Wake up! Come on, wake up!
wakeupdrunk|Wake up, you drunk!
whatwant|What do you want?
whereisthis|Where is this?
whoisit|Who is it?
whoisit-2|Is your mother there?
whoru|Who are you?
wtfgoinon|What the fuck is going on?
10hr|Ten dollars an hour.
300day|Three hundred dollars a day.
constwork|Construction work.
doingmyjob|Just doing my job.
dontdowork|I don't do that kind of work.
myjob|It's my job.
workalone|I work alone.
232|232.
232-2|Alton Drive.
232alton|232 Alton Drive.
addresses|You want names and addresses?
america|America.
aust|Austria.
california|California.
comefrom|Where do you come from?
faraway|Far away.
giveadd|Give me your address.
los|Los Angeles.
meetme|Meet me halfway.
mexico|Mexico.
rumford|Rumford.
rumford2029|Rumford, 2029.
sac|Sacramento.
50bucks|Fifty bucks.
getrefund|Can I get a refund?
haverefund|Can I have a refund?
howmuch|How much is that?
money|Money is important.
noextra|No extra charge.
no-money|I don't have any money.
arn|Arnold Schwarzenegger.
arn-5|Schwarzenegger.
arn-6|Schwarzenegger. (alternate)
anon|Arnold's name (unclear pronunciation).
berrerajose|Jose Barrera.
det|I'm Detective John Kimble.
ed-corney|Ed Corney.
hauser|Hauser.
iam|I am…
imterm|I'm a Terminator.
itsme|It's me.
jayne|Jayne.
johnconnor|John Connor.
johnkimble|I'm John Kimble.
katherine-brewster|Katherine Brewster.
mike-katz|Mike Katz.
miles|Miles Bennett Dyson.
quaid|Douglas Quaid.
sarah-connor|Sarah Connor.
sarah-connor-2|I'm a friend of Sarah Connor. I was told she's here.
thomas-aquinas|Thomas Aquinas.
whoami|Who am I?
haha|Laughter.
haha-long|Laughter (long).
reading|Reading (vocal sound).
scream-predator|Predator battle cry.
yak|Retching / gagging.
comeon|Come on!
come-on|Come on!
come-on-3|Come on, quickly!
doitnow|Do it now!
dowhatitell|Just do what I tell you.
hurry|Hurry up!
justdoit|Just do it.
now|Now! (shouted)
yesrightnow|Yes, right now.
calluback|I'll call you back.
dontcall|Don't call anybody.
phonecall|I'm making a phone call.
phonecall-2|I was expecting a phone call from you.
ansques|I hope you'll answer my questions.
fewques|I have a few more questions.
ques|I want to ask you a bunch of questions and have them answered immediately.
question|There's only one more question.
question-2|Answer my question.
tellme|Can you tell me?
absyeah|Absolutely, yeah.
beback|I'll be back.
bebothered|I don't want to be bothered.
beli|Do you expect me to believe you?
checkback|In case you forget, I'll be checking back with you.
doesmatter|It doesn't matter.
dontcare|I don't care.
donttalk|I don't want to talk about it.
dontworry|Don't worry.
forgetit|Forget it.
goodbye|Goodbye.
goon|Go on.
hearsaid|Did you hear what I said?
hearu|I can hear you.
hitspot|That hit the spot.
howknow|How do you know?
idk|I don't know.
ilied|I lied.
insist|I insist.
likethat|I like that.
nono|No, no, no.
noooooo|No! (shouted)
notgetinto|Let's not get into that.
notinterested|I'm not interested in that.
nottrue|No, it is not true.
ohno-r|Oh, no! (response)
point|What's your point?
proud|You must be very proud of yourself.
sayagain|Could you say that again?
sometrust|Somebody I could trust.
st8withme|Be straight with me.
tellmewhat|Tell me what?
thankyou|Thank you.
thatisfunny|That's funny.
trustme|Trust me.
trustme-2|You can count on me.
understand|Do you understand?
urlying|You're lying.
utellme|You tell me.
whatmean|What do you mean?
whatsmatter|What's the matter?
whatsmatter-2|What's the matter? The CIA got you pushing too many pencils?
whatsthat|What's that?
whattalk|What are you talking about?
whyilie|Why would I lie to you?
wrongthat|What's wrong with that?
yes-ang|Yes! (angry)
1sec|One second.
bathbrb|I'm going to the bathroom. I'll be back.
brbok|I'll be right back, okay?
hold|Hold on.
waitmin|Wait a minute.
choir|You're a fucking choirboy compared to me!
dontfuckbs|Don't fucking bullshit me.
drunkbitch|You drunk bitch!
drunkfuck|You drunk fuck!
eatme|Eat me.
fuckingcrazy|Are you fucking crazy?
fuckingcrazybitch|Are you fucking crazy, bitch?
guysass|That guy's ass.
hatedrunk|I hate drunks.
pissedoff|You pissed me off.
psychobitch|You psychopathic bitch!
stopbitch|Stop being such a bitch.
stopfa|Stop, you fucking asshole!
stoppussy|Stop being such a pussy.
whatisfnbs|What is this fucking bullshit?
wtfwrong4x|What the fuck did I do wrong? (repeated)
youbastards|You bastards!
aliens|Aliens?
dino|Dinosaurs.
getall|Get them all.
killeddino|Who killed the dinosaurs?
screwyou|Screw you!
inveover|The investigation is over.
jail|You're going to jail.
stealscar|He steals my car.
aaagghhoooooo|Aagh! (vocal outburst)
ninjanoises|Ninja fight noises.
yeahrrgghh|Yeah! (grunt)
warm|Can we go somewhere warm?
warm-2|Somewhere warm.
warm-3|I need to work on my tan.
vacsold|You sold me a vacation.
travelsame|Do we travel in the same circles?
pina|Piña colada.
43per|Forty-three percent.
make10|Make it ten.
gameover|Game over!
hasta|Hasta la vista, baby.
shower|I'm going to take a shower.
arrrrghhhh-3|Argh! (scream)
hol|Hold on. (short / uncertain)
news|I've got news for you.
stuttering|Stuttering / vocal sounds.
""".strip().splitlines())

# Familiar one-liners supplement the old primary choices when new clips exist.
PRIMARY = {
    "choppa", "choppa-2", "doitnow", "hasta", "gameover", "imterm",
    "daddy", "daddy-2", "daddy-3", "daddy-4", "daddy-5",
    "cookies", "cookies-2", "cookies-3", "beback", "imback", "cop", "det",
    "mine", "stopwhining", "sarah-connor", "sarah-connor-2", "choir",
    "news", "johnconnor", "johnkimble",
}


def main():
    manifest_path = DIRECTORY / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    old = {Path(c["file"]).stem: c for c in json.loads(
        (ROOT / "assets/audio/arnold/manifest.json").read_text())["clips"]}
    counts = {"primary": 0, "secondary": 0, "removed": 0}
    kept = []
    for clip in manifest["clips"]:
        source = DIRECTORY / clip["file"]
        stem = source.stem
        if stem in STOP:
            source.unlink(missing_ok=True)
            counts["removed"] += 1
            continue
        original_label = clip.setdefault("board_name", clip["name"])
        match = old.get(MATCHES.get(stem, ""))
        base = re.sub(r"-\d+$", "", stem)
        if stem in LABELS:
            name = LABELS[stem]
        elif match:
            name = match["name"]
        elif base in LABELS and base != stem:
            name = LABELS[base].rstrip(".!?") + f" (alternate {stem.rsplit('-', 1)[1]})."
        else:
            name = original_label
            if base != stem and re.search(r"\s\d+$", name):
                name = re.sub(r"\s(\d+)$", r" (alternate \1)", name)
        tier = "primary" if stem in PRIMARY or (match and match.get("tier") == "primary") else "secondary"
        destination = DIRECTORY / tier / source.name
        destination.parent.mkdir(exist_ok=True)
        if source != destination:
            if destination.exists():
                raise RuntimeError(f"Refusing to overwrite {destination}")
            source.rename(destination)
        clip.update(name=name, file=str(destination.relative_to(DIRECTORY)), tier=tier,
                    description_basis="Inferred from board label, filename, and old collection; not audio-verified")
        if match:
            clip["matched_old_file"] = match["file"]
        kept.append(clip)
        counts[tier] += 1
    organize(kept)
    manifest["clips"] = kept
    manifest["sorting"] = counts | {"basis": "Best-guess labels; editable in scripts/label_arnold_realm.py"}
    manifest["stats"] = {status: sum(c["status"] == status for c in kept)
                         for status in ("downloaded", "skipped", "failed")}
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(counts)


if __name__ == "__main__":
    main()
