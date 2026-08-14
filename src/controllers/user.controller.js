const User = require("../models/user.model");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendSuccess } = require("../utils/apiResponse");

// GET /api/v1/users/me
const getProfile = catchAsync(async (req, res) =>
  sendSuccess(res, {
    message: "Profile fetched successfully.",
    data: { user: req.user.toPublicJSON() },
  })
);

// PATCH /api/v1/users/me
const updateProfile = catchAsync(async (req, res) => {
  const { fullName, username } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    throw AppError.unauthorized("This account no longer exists.");
  }

  if (username !== undefined && username !== user.username) {
    const taken = await User.findOne({ username }).select("_id").lean();

    if (taken) {
      throw AppError.conflict("That username is already taken.");
    }

    user.username = username;
  }

  if (fullName !== undefined) user.fullName = fullName;

  await user.save();

  return sendSuccess(res, {
    message: "Profile updated successfully.",
    data: { user: user.toPublicJSON() },
  });
});

module.exports = { getProfile, updateProfile };
