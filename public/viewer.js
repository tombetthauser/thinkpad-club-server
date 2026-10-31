"use strict";

const slug = location.pathname === "/" ? "index" : location.pathname.slice(1);
const preview = document.getElementById("page-preview");
let actionBusy = false;
let password = "";
let robotController;

async function updateWebcam(doc, widget, direction) {
  if (actionBusy) return;
  actionBusy = true;
  const buttons = doc.querySelectorAll("[data-webcam-update], [data-robot-direction]");
  const message = direction
    ? doc.querySelector("[data-robot-status]")
    : widget.querySelector("[data-webcam-status]");
  const spinner = direction
    ? doc.querySelector(`[data-robot-spinner="${direction}"]`)
    : widget.querySelector("[data-webcam-spinner]");
  const frames = ["|", "/", "-", "\\"];
  let frame = 0;
  buttons.forEach(button => { button.disabled = true; });
  if (message) message.textContent = "";
  if (spinner) spinner.textContent = frames[0];
  const animation = spinner ? setInterval(() => {
    spinner.textContent = frames[++frame % frames.length];
  }, 120) : null;
  try {
    if (direction) {
      if (!["left", "right"].includes(direction)) throw new Error("Unknown direction");
      robotController ||= crypto.randomUUID();
      const command = action => fetch(`/api/robot/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Robot-Controller": robotController },
        body: JSON.stringify({ speed: 0.5 }),
        signal: AbortSignal.timeout(450)
      });
      let started = false;
      try {
        const response = await command(direction);
        if (!response.ok) throw new Error(await response.text());
        started = true;
        await new Promise(resolve => setTimeout(resolve, 500));
      } finally {
        if (started) {
          const response = await command("stop");
          if (!response.ok) throw new Error(await response.text());
        }
      }
    }
    const capture = () => fetch("/api/webcam/capture", {
      method: "POST", headers: { "X-Edit-Password": password }
    });
    let response = await capture();
    if (response.status === 401) {
      const entered = window.prompt("Enter the class password to update the webcam:");
      if (entered === null) {
        if (message) message.textContent = "Photo update cancelled.";
        return;
      }
      password = entered;
      response = await capture();
    }
    if (!response.ok) throw new Error(await response.text());
    const photo = await response.json();
    doc.querySelectorAll("[data-webcam-image]").forEach(image => {
      image.hidden = false;
      image.src = photo.url;
    });
    doc.querySelectorAll("[data-webcam-status]").forEach(label => {
      label.textContent = "";
    });
  } catch (error) {
    if (message) message.textContent = error.message;
  } finally {
    if (animation !== null) clearInterval(animation);
    if (spinner) spinner.textContent = "";
    buttons.forEach(button => { button.disabled = false; });
    actionBusy = false;
  }
}

function newPage() {
  const foods = "chocolate vanilla caramel cinnamon ginger lemon lime orange cherry strawberry blueberry raspberry blackberry peach plum apricot mango pineapple coconut banana apple pear melon kiwi papaya guava fig date raisin cranberry pumpkin carrot potato tomato cucumber avocado olive pickle pepper chili garlic onion basil mint parsley rosemary thyme sage sesame peanut almond cashew walnut pecan pistachio hazelnut chestnut honey maple molasses butterscotch toffee fudge marshmallow jelly jam marmalade custard pudding cookie biscuit brownie cupcake muffin waffle pancake pretzel popcorn noodle macaroni spaghetti ravioli lasagna dumpling taco burrito nacho salsa sushi wasabi miso tofu cheddar mozzarella parmesan gouda brie yogurt butter cream cocoa coffee espresso chai matcha oatmeal granola cereal bagel croissant sourdough pumpernickel cornbread shortbread snickerdoodle licorice peppermint spearmint bubblegum gumdrop lollipop sherbet sorbet gelato cheesecake fruitcake jellybean tangerine clementine nectarine persimmon pomegranate passionfruit dragonfruit starfruit lychee tamarind turmeric paprika nutmeg cardamom saffron lentil chickpea quinoa couscous tapioca".split(" ");
  const animals = "dolphin otter badger fox wolf coyote bear panda koala wombat kangaroo wallaby possum raccoon skunk squirrel chipmunk beaver porcupine hedgehog rabbit hare mouse rat hamster gerbil chinchilla capybara guinea-pig cat kitten dog puppy ferret weasel stoat mink marten wolverine lynx bobcat cougar leopard jaguar cheetah lion tiger ocelot serval caracal elephant rhino hippo giraffe zebra horse pony donkey tapir pig boar cow yak bison buffalo goat sheep alpaca llama camel deer moose elk reindeer antelope gazelle okapi sloth anteater armadillo pangolin aardvark bat lemur monkey gorilla chimpanzee orangutan gibbon meerkat mongoose hyena seal walrus manatee dugong whale narwhal beluga orca penguin puffin pelican flamingo heron crane stork ibis spoonbill duck goose swan loon grebe albatross seagull tern parrot macaw cockatoo toucan hornbill owl eagle hawk falcon kestrel vulture raven crow magpie jay robin sparrow finch canary cardinal starling swallow swift hummingbird woodpecker kingfisher kookaburra emu ostrich cassowary kiwi peacock pheasant quail turkey chicken rooster pigeon dove turtle tortoise gecko iguana chameleon skink lizard snake python cobra crocodile alligator frog toad newt salamander axolotl shark stingray manta seahorse goldfish guppy trout salmon tuna eel pufferfish clownfish angelfish swordfish octopus squid cuttlefish nautilus jellyfish starfish urchin crab lobster shrimp crayfish snail slug butterfly moth beetle ladybug firefly dragonfly damselfly cricket grasshopper mantis bumblebee honeybee ant termite cicada spider scorpion millipede centipede earthworm tardigrade platypus echidna quokka numbat bilby bandicoot".split(" ");
  const pick = words => words[Math.floor(Math.random() * words.length)];
  const suggestion = `${pick(foods)}-${pick(animals)}`;
  const entered = window.prompt("What would you like to call your page? Keep this name or choose your own.", suggestion);
  if (entered === null) return;
  const name = entered.trim().toLowerCase().replace(/\s+/g, "-");
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
      || ["index", "api", "assets", "uploads", "health", "webcam", "robot", "control", "edit", "reset"].includes(name)) {
    window.alert("Choose a name up to 64 characters, using letters, numbers, and single hyphens. That name may be reserved.");
    return;
  }
  location.assign(`/edit/${name}`);
}

function connectPage(doc) {
  if (!doc?.body) return;
  document.title = doc.title || "Thinkpad Club";
  // Configure native navigation before a tap. Some mobile browsers suppress
  // click callbacks attached to documents whose sandbox disables scripts.
  doc.querySelectorAll("a[href]").forEach(link => {
    const href = link.getAttribute("href");
    if (href.startsWith("#")) return;
    const address = new URL(href, location.href);
    if (!["http:", "https:", "mailto:", "tel:"].includes(address.protocol)) return;
    link.href = address.href;
    link.target = "_top";
  });
  doc.querySelectorAll("[data-webcam-image]").forEach(image => {
    const unavailable = () => {
      image.hidden = true;
      const label = image.closest("[data-webcam]")?.querySelector("[data-webcam-status]");
      if (label) label.textContent = "";
    };
    image.addEventListener("error", unavailable);
    if (image.complete && image.naturalWidth === 0) unavailable();
  });
  // Native click handles mouse, keyboard, and touch activation without duplicate captures.
  doc.addEventListener("click", event => {
    const target = event.target;
    const rotation = target.closest?.("[data-robot-direction]");
    if (rotation) {
      event.preventDefault();
      updateWebcam(doc, rotation.closest("[data-webcam]") || doc, rotation.dataset.robotDirection);
      return;
    }
    if (target.closest?.("[data-new-page]")) {
      event.preventDefault();
      newPage();
      return;
    }
    const button = target.closest?.("[data-webcam-update]");
    const widget = button?.closest("[data-webcam]");
    if (widget) {
      event.preventDefault();
      updateWebcam(doc, widget);
      return;
    }
    const link = target.closest?.("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (href.startsWith("#")) return;
    const address = new URL(href, location.href);
    if (!["http:", "https:", "mailto:", "tel:"].includes(address.protocol)) {
      event.preventDefault();
      return;
    }
    // Let the browser follow the user's tap directly, including in mobile Safari.
    // Resolve relative links against the public page, not the preview API URL.
    link.href = address.href;
    link.target = "_top";
  });
}
if (preview) {
  preview.addEventListener("load", () => connectPage(preview.contentDocument));
  preview.src = `/api/pages/${encodeURIComponent(slug)}/preview`;
} else {
  connectPage(document);
}
