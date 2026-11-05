"""Editorial section order and clip order, based on the board's inferred labels.

Earlier stems appear first; numbered variants stay beside the original. These
orders reflect recognizable lines and conversation flow, not measured popularity.
Audio files keep their existing primary/secondary paths.
"""
import re
from pathlib import Path

# Explicit filename stems, in preferred order within each section.
SECTIONS = [
    ("greetings", "Greetings & conversation starters", """
morn hi hello howdy howru howdoinbuddy sup supguys hihoney hellqtpie meetu imback
knowu lookingforsome listen look talkimp talksome wakeup wakeupdrunk surprise
"""),
    ("identity", "Who I am", """
cop det johnkimble imterm arn sarah-connor johnconnor quaid hauser conan julius
itsme iam whoami boris berrerajose dana dyson ed-corney franco jamie jamie-please
jayne katherine-brewster ken lamon lou mike-katz miles thomas-aquinas anon you
"""),
    ("questions", "Questions", """
daddy whoru realname whoisit whatwant what whatmean whatsthat why whynot whyilie
whereisshe whereshenow whereisthis whatsmatter whattalk goingon goingonnow
hellgoingon wtfgoinon findme gottado howknow point sayagain tellme tellmewhat
utellme ques fewques question ansques understand beli outofmind ucrazy funny
wrongthat aliens killeddino travelsame comefrom addresses howmuch rightnow break
dinner 2weekpack
"""),
    ("cookies", "Cookies, food & drink", """
cookies drinkbake hungry yummy pasta sourk lookstom makefat pina cake
"""),
    ("stop", "Shut up, stop & calm down", """
shutup shutup-3x shutupppp stfu stopit stopthat stopwhining stoplaugh dontscream
dontdothat leavealone stopbitch stopfa stoppussy dontcall donttalk notgetinto
dontworry
"""),
    ("insults", "Insults & angry reactions", """
fuass fu bullshit bulllllllshit dontbs dontfuckbs whatisfnbs wtf wtfwrong
wtfwrong4x idiot choir bastard coldblood youbastards bitch fuckbitch mfbitch sob
psychobitch fuckingcrazy fuckingcrazybitch drunkbitch drunkfuck hatedrunk eatme
kissmom lackdiscipline likeothers helldo hellthink crap disgusting
ohshit outr rid saysamething takeback udid ulie urlying ustarted storystraight
dontknowu guysass pissedoff sungdam
"""),
    ("action", "Commands, threats & action lines", """
choppa doitnow justdoit dowhatitell comeon come-on hurry immediately now yesrightnow
mine news stom deep screwyou getall dino dontdowork
"""),
    ("police", "Police, crime & work", """
underarrest arrest police charges drug cocaine talkcrime jail inveover stealscar
doingmyjob myjob workalone constwork 10hr 300day
"""),
    ("family", "Mother, wife & family", """
getmother talkmother speakwife mywife wifecrazy
"""),
    ("help", "Help & phone calls", """
helpneed helpwant helpmenow phonecall
"""),
    ("replies", "Answers & conversational reactions", """
yes yes-ang yeah absyeah correct exactly sure ok good terrific thankyou trustme sometrust
no negative nono noooooo nodeal nottrue ilied idk dontcare doesmatter insist
hearsaid hearu goon likethat thatisfunny proud hitspot huh so ohno ohno-r sorry st8withme meetme
"""),
    ("money", "Money, rooms & vacations", """
money 50bucks no-money noextra haverefund getrefund roomplease wantroom onenight
tonight vac vacsold warm
"""),
    ("places", "Places & addresses", """
232alton 232 rumford2029 rumford america aust california los miami mexico sac faraway
giveadd
"""),
    ("time", "Dates, times & numbers", """
1hr 253 618 645 1130 feb13 feb14 july oct7th timefor whenuwant
2 3 4 5 7 8 10 20 24 25 29 200 717 829 2029 3333 43per make10
"""),
    ("noises", "Laughs, screams & other noises", """
haha haha-long cough scream scream-predator ninjanoises aaagghhoooooo arrrrghhhh-3
yeahrrgghh yak reading stuttering
"""),
    ("enders", "Conversation enders & stepping away", """
hasta beback goodbye gameover calluback brbok bathbrb shower bebothered
notinterested forgetit checkback hold hol wait waitmin 1sec
"""),
]


def organize(clips):
    assignments = {}
    for section_index, (key, title, stems) in enumerate(SECTIONS):
        for rank, stem in enumerate(stems.split()):
            if stem in assignments:
                raise ValueError(f"Duplicate section assignment: {stem}")
            assignments[stem] = (key, title, section_index, rank)
    for clip in clips:
        stem = Path(clip["file"]).stem
        base = re.sub(r"-\d+$", "", stem)
        key, title, section_index, rank = assignments.get(stem, assignments.get(
            base, ("other", "Other lines", len(SECTIONS) - 1, 0)))
        # Keep any unfamiliar clips before the conversation enders.
        if key == "enders":
            section_index = len(SECTIONS)
        variant = int(stem.rsplit("-", 1)[-1]) if base != stem else 0
        clip.update(section=key, section_title=title, section_order=section_index,
                    order=rank * 100 + variant)
    clips.sort(key=lambda c: (c["section_order"], c["order"], c["name"].casefold()))
